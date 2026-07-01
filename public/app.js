const state = {
  stores: [],
  selectedStoreId: "",
  categoryTree: [],
  productStatus: "all",
  productRows: [],
  listingAttributes: [],
  listingVariantAspects: [],
  generatedListingContent: null,
  orderStatus: "",
  orderRows: [],
  promotionRows: [],
  selectedPromotion: null,
  promotionProducts: [],
  promotionCandidates: [],
  promotionProductKind: "products",
  collected1688: null,
  captureRows: [],
  currentCaptureId: "",
  currentCaptureDraft: null,
  categorySearchTimer: 0,
  categorySearchLoading: false,
  attributeValueCache: {},
  listingWarehouses: [],
  variantGroups: [],
  selectedVariantGroup: 0,
  reservedParentSkus: [],
  crawlerTasks: [],
  crawlerCandidates: [],
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
  reverseGuidanceCards: [],
  workflowRuns: [],
  workflowSummary: null,
  workflowFilter: "all",
  selectedWorkflowRunId: "",
  selectedWorkflowNodeKey: "",
};

const PURCHASE_COST_MARKUP_RMB = 5;
const PACKAGE_WEIGHT_PADDING_G = 50;
const PACKAGE_SIZE_PADDING_MM = 20;
const DEFAULT_LISTING_STOCK = 100;
const ERP_NAVIGATION_GROUPS = [
  { key: "store-overview", label: "店铺总览", views: ["dashboard"] },
  { key: "product-management", label: "商品管理", views: ["products"] },
  { key: "sourcing-procurement", label: "选品采购", views: ["sourcing", "research"] },
  { key: "listing-center", label: "上架中心", views: ["listing", "workflow-console"] },
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
    title: "1688 采集",
    handles: "只处理 1688 货源采集、采集箱、候选解析和生成上架草稿。",
    excludes: "不处理 Ozon 活动、订单履约、库存提交和在售商品维护。",
    wrongPageHint: "看到活动或订单字段时说明页面串区；请切回对应运营 tab。",
  },
  listing: {
    title: "上架草稿",
    handles: "只处理 Ozon 上架草稿、类目属性、标题描述、图片、价格、预检和提交闸口。",
    excludes: "不处理 Ozon 营销活动、订单履约、库存队列和竞品样本采集。",
    wrongPageHint: "如果你只是处理活动商品，不应该出现在这里。",
  },
  "workflow-console": {
    title: "节点诊断",
    handles: "只处理商品流程卡点、错误原因、字段定位、重试、换货源和提交闸口。",
    excludes: "不作为普通商品列表、不作为活动运营页、不承载完整上架表单。",
    wrongPageHint: "这里应该看到问题、原因、推荐动作，而不是完整商品编辑表。",
  },
  research: {
    title: "Ozon 参照与图片",
    handles: "只处理 Ozon 样本、同品参照、图片风格、文案指导和图片生成建议。",
    excludes: "不直接提交 Ozon、不处理订单、库存和营销活动。",
    wrongPageHint: "学习结果只反哺上架，不替代上架草稿。",
  },
  products: {
    title: "商品状态",
    handles: "只处理 Ozon 商品列表、状态分组、价格读取、在售/错误/待修改状态观察。",
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
    title: "采一个 1688 商品",
    primary: "这里先完成采集、候选解析和入草稿；高级队列、Cookie、人机状态默认收起。",
    actions: [
      { label: "打开采集任务", view: "sourcing" },
      { label: "去上架草稿", view: "listing" },
      { label: "看节点诊断", view: "workflow-console" },
    ],
  },
  listing: {
    title: "把一个商品变成 Ozon 草稿",
    primary: "这里只处理类目、属性、文案、图片、定价、预检；提交 Ozon 必须人工确认。",
    actions: [
      { label: "检查类目属性", view: "listing" },
      { label: "查看定价诊断", view: "listing" },
      { label: "提交前预检", view: "workflow-console" },
    ],
  },
  "workflow-console": {
    title: "修一个卡住的节点",
    primary: "这里不再说笼统人工干预，只看问题、原因、推荐动作、点了以后会发生什么。",
    actions: [
      { label: "查看失败原因", view: "workflow-console" },
      { label: "回上架草稿修字段", view: "listing" },
      { label: "换 1688 货源", view: "sourcing" },
    ],
  },
  research: {
    title: "给上架做参考",
    primary: "这里采 Ozon 同品、生成文案和图片指导；结果只反哺草稿，不直接上架。",
    actions: [
      { label: "打开参照学习", view: "research" },
      { label: "生成图片指导", view: "research" },
      { label: "回上架草稿", view: "listing" },
    ],
  },
  products: {
    title: "看商品现在怎么样",
    primary: "这里看商品是否在售、审核中、失败、缺价、缺库存；不新增商品。",
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
    status: "部分对齐",
    api: ["/v3/posting/fbs/list", "/v3/posting/fbs/unfulfilled/list"],
    gap: "当前偏看板；打包、发运、取消、标签等履约动作未接齐。",
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
    api: ["/v3/posting/fbs/list", "/v3/posting/fbs/unfulfilled/list"],
    task: "在现有订单看板基础上拆出待接入动作：打包、发运、取消、标签/条码。",
    reason: "目前订单偏只读，看板能看但不能形成履约操作闭环。",
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
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
    ? `Client ID: ${store.clientId} / Key: ${store.apiKey}`
    : "未找到店铺";
  syncListingStore();
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

function currentListingWorkflowRun() {
  const runs = Array.isArray(state.workflowRuns) ? state.workflowRuns : [];
  if (!runs.length) return null;
  const selected = runs.find((run) => run.id === state.selectedWorkflowRunId);
  if (selected) return selected;
  return [...runs].sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0] || null;
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

function listingFillTaskRepairCandidate(run = currentListingWorkflowRun()) {
  if (!run) return null;
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return null;
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const matrix = run.payloadDraftValidation?.attributeMatrix || preflightNode.output?.attributeMatrix || null;
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      const guidance = cell.repairGuidance || {};
      const candidates = Array.isArray(guidance.dictionaryCandidates) ? guidance.dictionaryCandidates : [];
      const candidate = candidates[0] || null;
      if (guidance.canApplyLocalDraftRepair === true && candidate) {
        return {
          runId: run.id || "",
          nodeKey: preflightNode.key || "preflight_check",
          offerId: guidance.offerId || cell.offerId || "",
          attributeId: guidance.attributeId || row.attributeId || "",
          attributeName: guidance.attributeName || row.name || "",
          dictionaryValueId: candidate.dictionary_value_id || candidate.dictionaryValueId || "",
          value: candidate.value || "",
        };
      }
    }
  }
  return null;
}

function listingFillTaskTextRepairCandidate(run = currentListingWorkflowRun()) {
  if (!run) return null;
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return null;
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const matrix = run.payloadDraftValidation?.attributeMatrix || preflightNode.output?.attributeMatrix || null;
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      const guidance = cell.repairGuidance || {};
      if (guidance.canApplyTextDraftRepair === true) {
        return {
          runId: run.id || "",
          nodeKey: preflightNode.key || "preflight_check",
          offerId: guidance.offerId || cell.offerId || "",
          attributeId: guidance.attributeId || row.attributeId || "",
          attributeName: guidance.attributeName || row.name || "",
        };
      }
    }
  }
  return null;
}

function listingFillTaskVariantTextRepairCandidate(run = currentListingWorkflowRun()) {
  if (!run) return null;
  const waitingHuman = run.status === "waiting_human" || run.locks?.waitingHuman === true;
  if (!waitingHuman) return null;
  const preflightNode = (run.nodes || []).find((node) => node.key === "preflight_check") || {};
  const matrix = run.payloadDraftValidation?.attributeMatrix || preflightNode.output?.attributeMatrix || null;
  const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
  for (const row of rows) {
    for (const cell of row.cells || []) {
      const guidance = cell.repairGuidance || {};
      if (guidance.canApplyVariantTextDraftRepair === true) {
        return {
          runId: run.id || "",
          nodeKey: preflightNode.key || "preflight_check",
          offerId: guidance.offerId || cell.offerId || "",
          attributeId: guidance.attributeId || row.attributeId || "",
          attributeName: guidance.attributeName || row.name || "",
        };
      }
    }
  }
  return null;
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
  const variantConfiguration = validation.variantConfiguration || preflightOutput.variantConfiguration || null;
  const listingQuality = validation.listingQuality || preflightOutput.listingQuality || null;
  const repairCandidate = listingFillTaskRepairCandidate(run);
  const textRepairCandidate = listingFillTaskTextRepairCandidate(run);
  const variantTextRepairCandidate = listingFillTaskVariantTextRepairCandidate(run);
  const variantAspectSuggestion = listingFillTaskVariantAspectSuggestion(variantConfiguration);
  const items = [];
  if (Array.isArray(requiredAttributeFillPlan) && requiredAttributeFillPlan.length) {
    const autoCount = Number(requiredAttributeFillSummary?.autofillSafeCount ?? requiredAttributeFillPlan.filter((row) => row.action === "auto_fill").length);
    const confirmCount = Number(requiredAttributeFillSummary?.candidateNeedsHumanConfirmationCount ?? requiredAttributeFillPlan.filter((row) => row.action === "suggest_dictionary").length);
    const manualCount = Number((requiredAttributeFillSummary?.manualRequiredCount ?? 0) + (requiredAttributeFillSummary?.blockedNeverGuessCount ?? 0))
      || requiredAttributeFillPlan.filter((row) => ["manual_required", "blocked_sensitive"].includes(row.action)).length;
    items.push({
      tone: manualCount ? "warning" : confirmCount ? "info" : "success",
      label: "分类属性",
      title: `${requiredAttributeFillPlan.length} 个必填属性任务`,
      body: `${autoCount} 个已安全补齐，${confirmCount} 个需确认字典，${manualCount} 个需人工处理。`,
      meta: requiredAttributeFillSummary?.safeNextAction || "数据来自 requiredAttributeFillPlan，只读汇总，不自动写入或提交。",
      target: "content-images",
      repairCandidate: repairCandidate && confirmCount ? repairCandidate : null,
      textRepairCandidate: textRepairCandidate && manualCount ? textRepairCandidate : null,
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
            ${item.repairCandidate ? `<button
              type="button"
              data-workflow-action="apply-attribute-dictionary-repair"
              data-workflow-run-id="${escapeHtml(item.repairCandidate.runId)}"
              data-workflow-node-key="${escapeHtml(item.repairCandidate.nodeKey)}"
              data-repair-offer-id="${escapeHtml(item.repairCandidate.offerId)}"
              data-repair-attribute-id="${escapeHtml(item.repairCandidate.attributeId)}"
              data-repair-dictionary-value-id="${escapeHtml(item.repairCandidate.dictionaryValueId)}"
              data-repair-value="${escapeHtml(item.repairCandidate.value)}"
              title="${escapeHtml(item.repairCandidate.attributeName || "字典属性")}"
            >确认写入草稿并预检</button>` : ""}
            ${item.textRepairCandidate ? `<button
              type="button"
              data-workflow-action="apply-attribute-text-repair"
              data-workflow-run-id="${escapeHtml(item.textRepairCandidate.runId)}"
              data-workflow-node-key="${escapeHtml(item.textRepairCandidate.nodeKey)}"
              data-repair-offer-id="${escapeHtml(item.textRepairCandidate.offerId)}"
              data-repair-attribute-id="${escapeHtml(item.textRepairCandidate.attributeId)}"
              title="${escapeHtml(item.textRepairCandidate.attributeName || "文本属性")}"
            >填写文本属性并预检</button>` : ""}
            ${item.variantTextRepairCandidate ? `<button
              type="button"
              data-workflow-action="apply-variant-text-repair"
              data-workflow-run-id="${escapeHtml(item.variantTextRepairCandidate.runId)}"
              data-workflow-node-key="${escapeHtml(item.variantTextRepairCandidate.nodeKey)}"
              data-repair-offer-id="${escapeHtml(item.variantTextRepairCandidate.offerId)}"
              data-repair-attribute-id="${escapeHtml(item.variantTextRepairCandidate.attributeId)}"
              title="${escapeHtml(item.variantTextRepairCandidate.attributeName || "变体文本属性")}"
            >填写变体文本并预检</button>` : ""}
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
  const latestRun = [...(state.workflowRuns || [])]
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
      stuckAt: currentProductTask.blockedAt || workflowNodeTitle(currentProductTask.nodeKey || ""),
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
  return [...(state.workflowRuns || [])]
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
  const blockedAt = task.blockedAt || workflowNodeTitle(task.nodeKey || "") || task.stage;
  const reason = task.reason || "当前商品需要按工作流摘要处理。";
  const nextAction = task.nextAction || "进入对应业务模块继续处理。";
  return `
    <article class="${placement}" aria-label="当前商品任务">
      <span>当前商品任务 · ${escapeHtml(statusLabel)}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(blockedAt)}：${escapeHtml(reason)}</p>
      <small>安全下一步：${escapeHtml(nextAction)}</small>
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

function renderStoreOperatingOverview() {
  const sales = $("#storeSalesOverview");
  const health = $("#storeBusinessHealthGrid");
  const reminderRail = $("#todayReminderRail");
  const orders = state.orderRows || [];
  const products = state.productRows || [];
  const promotions = state.promotionRows || [];
  const workflows = state.workflowRuns || [];
  const summary = state.workflowSummary || {};
  const currentProductTask = latestCurrentProductTask();
  const orderRevenue = orders.reduce((total, order) => {
    const productsTotal = (order.products || []).reduce((sum, product) => sum + Number(product.price || product.offer_price || 0), 0);
    return total + productsTotal;
  }, 0);
  const awaitingOrders = orders.filter((order) => ["awaiting_packaging", "awaiting_deliver"].includes(order.status)).length;
  const riskyProducts = products.filter((item) => ["error", "needFix"].includes(item.status_group) || item.status === "error").length;
  const lowStockProducts = products.filter((item) => Number(item.stocks?.present || item.stock || 0) <= 0).length;
  const activePromotions = promotions.filter((item) => !/inactive|closed|finished/i.test(String(item.status || ""))).length;
  const waitingHuman = Number(summary.waitingHuman || workflows.filter((run) => run.status === "waiting_human").length);
  if (sales) {
    sales.innerHTML = `
      <article><span>今日销售额</span><strong>${orderRevenue ? orderRevenue.toFixed(0) : "-"}</strong><small>基于已加载订单估算</small></article>
      <article><span>今日订单</span><strong>${orders.length || "-"}</strong><small>${awaitingOrders} 单待备货/发运</small></article>
      <article><span>商品风险</span><strong>${riskyProducts}</strong><small>${products.length || 0} 个商品已加载</small></article>
      <article><span>活动中</span><strong>${activePromotions}</strong><small>${promotions.length || 0} 个活动已加载</small></article>
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
        <div><span>订单履约</span><strong>${awaitingOrders ? "有待处理" : "暂无积压"}</strong></div>
        <p>${awaitingOrders ? `${awaitingOrders} 单需要备货或发运。` : "已加载订单里没有待备货/待发运积压。"}</p>
        <button type="button" data-cockpit-view="orders">进入订单履约</button>
      </section>
      <section id="storeInventoryRisk" class="store-health-panel">
        <div><span>库存仓库</span><strong>${lowStockProducts ? "有风险" : "待同步"}</strong></div>
        <p>${lowStockProducts ? `${lowStockProducts} 个商品可能缺库存。` : "库存风险会在商品和仓库数据加载后更新。"}</p>
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

function domainPanelSnapshot() {
  const orders = state.orderRows || [];
  const products = state.productRows || [];
  const promotions = state.promotionRows || [];
  const workflows = state.workflowRuns || [];
  const summary = state.workflowSummary || {};
  const revenue = orders.reduce((total, order) => {
    const productTotal = (order.products || []).reduce((sum, product) => sum + Number(product.price || product.offer_price || 0), 0);
    return total + productTotal;
  }, 0);
  const awaitingOrders = orders.filter((order) => ["awaiting_packaging", "awaiting_deliver"].includes(order.status)).length;
  const disputeOrders = orders.filter((order) => order.status === "dispute" || String(order.substatus || "").includes("dispute")).length;
  const cancelledOrders = orders.filter((order) => order.status === "cancelled").length;
  const riskyProducts = products.filter((item) => ["error", "needFix"].includes(item.status_group) || item.status === "error");
  const lowStockProducts = products.filter((item) => Number(item.stocks?.present || item.stock || 0) <= 0);
  const activePromotions = promotions.filter((item) => !/inactive|closed|finished/i.test(String(item.status || "")));
  const waitingHuman = Number(summary.waitingHuman || workflows.filter((run) => run.status === "waiting_human").length);
  const highRisk = Number(summary.highRisk || workflows.filter((run) => run.summary?.riskLevel === "high").length);
  const blocked = Number(summary.blocking || workflows.filter((run) => run.status === "blocked" || run.summary?.blockingNodeName).length);
  return {
    orders,
    products,
    promotions,
    workflows,
    revenue,
    awaitingOrders,
    disputeOrders,
    cancelledOrders,
    riskyProducts,
    lowStockProducts,
    activePromotions,
    waitingHuman,
    highRisk,
    blocked,
  };
}

function domainMetricCard(label, value, note, view) {
  return `
    <article class="domain-metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
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
  if (grid) {
    grid.innerHTML = [
      domainMetricCard("已加载销售额", snapshot.revenue ? snapshot.revenue.toFixed(0) : "-", "来自当前订单缓存估算", "orders"),
      domainMetricCard("价格/利润风险", snapshot.highRisk + snapshot.blocked, "来自 workflow 定价和预检风险", "workflow-console"),
      domainMetricCard("活动中商品域", snapshot.activePromotions.length, "活动价风险进入营销活动", "promotions"),
      domainMetricCard("待核算订单", snapshot.orders.length, "后续接入佣金、物流费和结算", "reports"),
    ].join("");
  }
  if (list) {
    const items = [
      snapshot.highRisk ? domainRiskItem("高风险定价", `${snapshot.highRisk} 条流程需要复核利润或最低价。`, "workflow-console", "warning") : "",
      snapshot.activePromotions.length ? domainRiskItem("活动价格影响利润", `${snapshot.activePromotions.length} 个活动可能影响毛利。`, "promotions", "info") : "",
      domainRiskItem("利润口径", "采购成本、物流费、佣金、杂费、活动折扣统一在财务利润页汇总。", "finance", "info"),
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
      snapshot.disputeOrders ? domainRiskItem("优先处理争议", `${snapshot.disputeOrders} 个争议订单需要售后介入。`, "orders", "danger") : "",
      snapshot.cancelledOrders ? domainRiskItem("取消订单复盘", `${snapshot.cancelledOrders} 个取消订单需要归因。`, "orders", "warning") : "",
      snapshot.riskyProducts.length ? domainRiskItem("商品资料风险", `${snapshot.riskyProducts.length} 个商品异常可能影响售后。`, "products", "warning") : "",
      domainRiskItem("售后数据接口", "后续接入评价、退货、纠纷和客服消息后，这里成为售后主队列。", "service", "info"),
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
      domainMetricCard("营销活动", snapshot.promotions.length, "活动表现和候选商品来源", "promotions"),
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
  if (grid) {
    grid.innerHTML = [
      domainMetricCard("店铺 API", $("#healthStatus")?.textContent || "未测试", `${state.stores.length} 个店铺`, "dashboard"),
      domainMetricCard("1688 采集器", workerOnline ? "在线" : "待连接", "浏览器插件与人机状态", "sourcing"),
      domainMetricCard("自动化锁", snapshot.waitingHuman, "waiting_human 流程必须人工处理", "workflow-console"),
      domainMetricCard("运行流程", snapshot.workflows.length, "工作流日志和高级诊断", "workflow-console"),
    ].join("");
  }
  if (list) {
    list.innerHTML = [
      domainRiskItem("Ozon 提交安全", "提交商品必须通过 preflight，并带 confirmSubmit 人工确认。", "workflow-console", "warning"),
      domainRiskItem("自动化模式", "默认 observe_only；高风险动作不自动提交外部平台。", "system", "info"),
      domainRiskItem("字典与插件", "Ozon 类目属性字典、1688 插件、运行日志统一在系统配置维护。", "system", "info"),
    ].join("");
  }
}

function renderSecondaryDomainPanels() {
  renderFinanceProfitPanel();
  renderServiceRiskPanel();
  renderReportsPanel();
  renderSystemConfigPanel();
}

function renderCockpitDashboard() {
  renderStoreOperatingOverview();
  const summary = state.workflowSummary || {};
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
      <article><span>运行中工作流</span><strong>${Number(summary.running || 0)}</strong><small>总计 ${Number(summary.total || state.workflowRuns.length || 0)}</small></article>
      <article class="${waitingHuman ? "is-warning" : ""}"><span>等待人工</span><strong>${waitingHuman}</strong><small>高风险 ${Number(summary.highRisk || 0)}</small></article>
      <article><span>近 14 天 FBS 单</span><strong id="orderCount">${escapeHtml($("#orderCount")?.textContent || "-")}</strong><small>订单履约</small></article>
      <article><span>系统状态</span><strong id="healthStatus">${escapeHtml($("#healthStatus")?.textContent || "未测试")}</strong><small><span id="storeCount">${state.stores.length}</span> 店铺 · <span id="warehouseCount">${escapeHtml($("#warehouseCount")?.textContent || "-")}</span> 仓库</small></article>
    `;
  }
  const focus = $("#cockpitWorkflowFocus");
  if (focus) {
    const runs = [...(state.workflowRuns || [])].sort((left, right) => {
      const leftRisk = left.status === "waiting_human" ? 2 : (left.summary?.riskLevel === "high" ? 1 : 0);
      const rightRisk = right.status === "waiting_human" ? 2 : (right.summary?.riskLevel === "high" ? 1 : 0);
      return rightRisk - leftRisk;
    }).slice(0, 4);
    focus.innerHTML = `
      <div class="section-headline"><div><h2>当前工作流焦点</h2><p class="hint">优先显示等待人工和高风险任务。</p></div><button class="ghost" type="button" data-cockpit-view="workflow-console">查看全部 ${state.workflowRuns.length}</button></div>
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
  if (active === "orders") loadOrders();
  if (active === "products") loadProducts();
  if (active === "promotions") {
    state.selectedPromotion = null;
    state.promotionRows = [];
    state.promotionProducts = [];
    state.promotionCandidates = [];
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
    showResponse(data);
    toast("API 连通正常");
  } catch (error) {
    $("#healthStatus").textContent = "异常";
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadWarehouses() {
  const button = $("#loadWarehouses");
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon/warehouses?storeId=${encodeURIComponent(selectedStoreId())}`);
    const warehouses = data.result || data.warehouses || [];
    $("#warehouseCount").textContent = Array.isArray(warehouses) ? warehouses.length : "-";
    $("#warehouseList").innerHTML = Array.isArray(warehouses) && warehouses.length
      ? warehouses.map((warehouse) => `
          <article>
            <strong>${warehouse.name || warehouse.warehouse_name || "未命名仓库"}</strong>
            <code>ID: ${warehouse.warehouse_id || warehouse.id || "-"}</code>
            <span>类型: ${warehouse.type || warehouse.delivery_method_type || "-"}</span>
            <span>状态: ${warehouse.status || (warehouse.is_rfbs ? "rfbs" : "-")}</span>
          </article>
        `).join("")
      : "<p class=\"hint\">没有返回仓库数据。</p>";
    showResponse(data);
    toast("仓库已读取");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadListingWarehouses() {
  try {
    const data = await api(`/api/ozon/warehouses?storeId=${encodeURIComponent(selectedStoreId())}`);
    const warehouses = data.warehouses || [];
    state.listingWarehouses = warehouses.filter((warehouse) => warehouse.status === "created" || warehouse.is_rfbs);
    const options = warehouses
      .filter((warehouse) => warehouse.status === "created" || warehouse.is_rfbs)
      .map((warehouse) => `<option value="${warehouse.warehouse_id}">${warehouse.name} - ${warehouse.warehouse_id}</option>`)
      .join("");
    document.querySelectorAll(".variant-warehouse, #listingWarehouse").forEach((select) => {
      const selected = select.value;
      select.innerHTML = options;
      if ([...select.options].some((option) => option.value === selected)) {
        select.value = selected;
      }
    });
  } catch {
    document.querySelectorAll(".variant-warehouse, #listingWarehouse").forEach((select) => {
      select.innerHTML = "";
    });
  }
}

async function loadOrders() {
  const button = $("#loadOrders");
  setBusy(button, true);
  try {
    const params = new URLSearchParams({
      storeId: selectedStoreId(),
      limit: "100",
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

    const data = await api(`/api/ozon/order-dashboard?${params}`);
    state.orderRows = state.orderStatus === "dispute"
      ? (data.orders || []).filter((order) => order.substatus?.includes("dispute"))
      : data.orders || [];
    $("#orderCount").textContent = state.orderRows.length;
    updateOrderCounts(data.counts || {});
    updateOrderFilterOptions(data.orders || []);
    renderOrders();
    showResponse(data);
    toast("FBS 订单已读取");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function updateOrderCounts(counts) {
  document.querySelectorAll("#orderStatusTabs .product-tab").forEach((tab) => {
    const key = tab.dataset.status || "all";
    tab.querySelector("span").textContent = counts[key] ?? 0;
  });
}

function updateOrderFilterOptions(orders) {
  const currentWarehouse = $("#orderWarehouse").value;
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
}

function renderOrders() {
  const service = $("#orderService").value;
  const rows = service
    ? state.orderRows.filter((order) => order.delivery_service === service)
    : state.orderRows;
  $("#ordersTable").innerHTML = rows.length
    ? rows.map(orderRowHtml).join("")
    : "<tr><td colspan=\"10\" class=\"product-empty\">没有订单数据。</td></tr>";
}

function orderRowHtml(order) {
  const firstProduct = order.products[0] || {};
  const productsHtml = order.products.map((product) => `
    <div class="order-product-line">
      <strong>${product.quantity} x ${escapeHtml(product.offer_id || product.sku || "-")}</strong>
      <span>${escapeHtml(product.name || "-")}</span>
    </div>
  `).join("");
  const image = firstProduct.image
    ? `<img class="product-photo" src="${firstProduct.image}" alt="${escapeHtml(firstProduct.name || "")}" />`
    : `<div class="photo-placeholder">＋</div>`;
  const weightText = order.declaration_weight_required ? "需填写" : "不适用";
  return `
    <tr>
      <td>
        <div class="product-offer">
          <strong>${escapeHtml(order.posting_number || "-")}</strong>
          <span>${escapeHtml(order.tracking_number || "")}</span>
        </div>
      </td>
      <td><span class="status-pill ${order.status}">${escapeHtml(order.status_label || "-")}</span></td>
      <td>${formatDateTime(order.accepted_at)}</td>
      <td>${formatDateTime(order.shipment_date)}<div class="status-sub">不延期</div></td>
      <td>${image}</td>
      <td>${productsHtml}</td>
      <td>${formatMoney(order.price)} ${order.currency_code}</td>
      <td>${escapeHtml(order.warehouse || "-")}</td>
      <td>${escapeHtml(order.delivery_service || "-")}<div class="status-sub">${escapeHtml(order.delivery_type || order.delivery_method || "")}</div></td>
      <td>${weightText}</td>
    </tr>
  `;
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

async function loadCaptureBox() {
  const data = await api("/api/1688/captures");
  state.captureRows = data.items || [];
  renderCaptureBox();
}

async function loadCrawlerTasks() {
  const data = await api("/api/1688-crawler/tasks");
  state.crawlerTasks = data.items || [];
  if (!state.selectedCrawlerTaskId && state.crawlerTasks.length) {
    state.selectedCrawlerTaskId = state.crawlerTasks[0].id;
  }
  renderCrawlerTaskRows();
  renderCrawlerLivePanel();
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
  const params = new URLSearchParams();
  if (state.selectedCrawlerTaskId) params.set("taskId", state.selectedCrawlerTaskId);
  const status = $("#crawlerCandidateStatus")?.value.trim();
  const query = $("#crawlerCandidateQuery")?.value.trim();
  if (status) params.set("status", status);
  if (query) params.set("query", query);
  const data = await api(`/api/1688-crawler/candidates?${params}`);
  state.crawlerCandidates = data.items || [];
  renderCrawlerCandidateRows();
  renderCrawlerTaskRows();
  renderCrawlerLivePanel();
}

function renderCrawlerCandidateRows() {
  const tbody = $("#crawlerCandidateRows");
  if (!tbody) return;
  tbody.innerHTML = state.crawlerCandidates.length
    ? state.crawlerCandidates.map((item) => `
      <tr data-candidate-id="${escapeHtml(item.id)}">
        <td>
          <strong>${escapeHtml(item.title || "未命名商品")}</strong>
          <div class="status-sub"><a href="${escapeHtml(item.url || "#")}" target="_blank">${escapeHtml(item.url || "-")}</a></div>
        </td>
        <td>${escapeHtml(item.priceMin || "-")}${item.priceMax && item.priceMax !== item.priceMin ? ` ~ ${escapeHtml(item.priceMax)}` : ""}</td>
        <td>${escapeHtml(item.skuCount || 0)}</td>
        <td>${item.sizeWeightReady ? "完整" : "缺失"}</td>
        <td>${escapeHtml(item.score || 0)}</td>
        <td>${escapeHtml(item.status || "-")}</td>
        <td class="row-actions">
          <button class="small-blue crawler-to-capture" type="button">入采集箱</button>
          <button class="ghost crawler-ignore" type="button">忽略</button>
        </td>
      </tr>
    `).join("")
    : "<tr><td colspan=\"7\" class=\"product-empty\">暂无候选数据</td></tr>";
  bindCrawlerCandidateRows();
}

function bindCrawlerCandidateRows() {
  document.querySelectorAll("#crawlerCandidateRows tr[data-candidate-id]").forEach((row) => {
    const id = row.dataset.candidateId;
    row.querySelector(".crawler-ignore")?.addEventListener("click", async () => {
      await api(`/api/1688-crawler/candidates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ignored" }),
      });
      await loadCrawlerCandidates();
      toast("候选已标记为忽略");
    });
    row.querySelector(".crawler-to-capture")?.addEventListener("click", () => moveCrawlerCandidateToCapture(id));
  });
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
  const data = await api("/api/ozon-learning/tasks");
  state.ozonLearningTasks = data.items || [];
  if (!state.selectedOzonLearningTaskId && state.ozonLearningTasks.length) {
    state.selectedOzonLearningTaskId = state.ozonLearningTasks[0].id;
  }
  renderOzonLearningTaskRows();
}

async function loadOzonLearningItems() {
  const params = new URLSearchParams();
  if (state.selectedOzonLearningTaskId) params.set("taskId", state.selectedOzonLearningTaskId);
  const query = $("#ozonLearningQuery")?.value.trim();
  if (query) params.set("query", query);
  const data = await api(`/api/ozon-learning/items?${params}`);
  state.ozonLearningItems = data.items || [];
  renderOzonLearningItemRows();
  renderOzonLearningTaskRows();
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
        const draftStatus = captureDraftVariantStatuses(item);
        return `
          <tr data-id="${item.id}">
            <td><input class="capture-check" type="checkbox" /></td>
            <td>${formatDateTime(item.updatedAt || item.receivedAt)}</td>
            <td>
              <select class="capture-store">
                ${state.stores.map((row) => `<option value="${row.id}" ${row.id === item.storeId ? "selected" : ""}>${escapeHtml(row.name)}</option>`).join("")}
              </select>
            </td>
            <td>
              <strong>${escapeHtml(product.title || "未命名商品")}</strong>
              <div class="status-sub">${escapeHtml(product.url || "")}</div>
              ${warningBadge}
            </td>
            <td>${product.skuVariants?.length || 0}</td>
            <td>${product.video?.url ? "有" : "无"}</td>
            <td>
              ${escapeHtml(item.status || "collected")}
              ${draftStatus ? `<div class="status-sub">${escapeHtml(draftStatus)}</div>` : ""}
            </td>
            <td class="row-actions">
              <button class="small-blue edit-capture" type="button">编辑</button>
              <button class="ghost promote-capture-candidate" type="button">转候选池</button>
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

async function switchStoreContext(storeId) {
  if (!storeId) throw new Error("采集记录没有归属店铺，请先在采集箱选择店铺");
  if (!state.stores.some((store) => store.id === storeId)) {
    throw new Error(`找不到采集记录归属店铺：${storeId}`);
  }
  if ($("#storeSelect").value !== storeId) {
    $("#storeSelect").value = storeId;
    updateStoreHint();
  }
  await loadListingWarehouses();
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
    row.querySelector(".edit-capture")?.addEventListener("click", () => editCaptureItem(id));
    row.querySelector(".promote-capture-candidate")?.addEventListener("click", () => promoteCaptureToCandidate(id));
    row.querySelector(".delete-capture")?.addEventListener("click", () => deleteCaptureItem(id));
  });
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
      await editCaptureItem(id, storeId);
      assertListingBoundToCapture(state.captureRows.find((item) => item.id === id) || { id, parsed: state.collected1688 });
      await saveListingDraft("draft");
      result.push({ id, storeId, ok: true, parentSku: $("#listingParentSku").value });
    } catch (error) {
      result.push({ id, storeId, ok: false, error: error.message });
      await api(`/api/1688/captures/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "error", lastError: error.message }),
      });
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
      ensureCaptureReadyForBatchPublish(savedItem);
      await editCaptureItem(id, storeId, { useSavedDraft: true });
      assertListingBoundToCapture(state.captureRows.find((item) => item.id === id) || { id, parsed: state.collected1688 });
      $("#listingTaskId").value = "";
      await submitListing();
      const taskId = $("#listingTaskId").value;
      if (!taskId) throw new Error("提交失败，未返回 Task ID");
      result.push({ id, storeId, ok: true, taskId });
    } catch (error) {
      result.push({ id, storeId, ok: false, error: error.message });
      await api(`/api/1688/captures/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "error", lastError: error.message }),
      });
    }
  }
  await loadCaptureBox();
  showResponse({ batchPublish: result });
  const okCount = result.filter((item) => item.ok).length;
  toast(`批量自动上架完成：成功 ${okCount} / ${selections.length}`);
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

function render1688Collection(data) {
  $("#collectTitle").textContent = data.title || "-";
  $("#collectSkuCount").textContent = data.skuVariants?.length || 0;
  $("#collectImageCount").textContent = data.images?.length || 0;
  $("#collectAttrCount").textContent = data.attributes?.length || 0;
  $("#collectWarnings").innerHTML = (data.warnings || []).map((warning) => `<p>${escapeHtml(warning)}</p>`).join("");
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
      <td><input id="listingStock" value="100" /></td>
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
        <td><input class="variant-price" value="${escapeHtml(price)}" /></td>
        <td><input class="variant-cost-price" value="${escapeHtml(purchasePrice || 0)}" /></td>
        <td><input class="variant-old-price" value="${escapeHtml(oldPrice)}" /></td>
        <td><input class="variant-min-price" value="${escapeHtml(minPrice)}" ${$("#enableLowestPrice")?.checked === false ? "disabled" : ""} /></td>
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
    <th><b>*</b>售价<br /><span>CNY</span></th>
    <th>成本价<br /><span>CNY</span></th>
    <th>划线价<br /><span>CNY</span></th>
    <th>最低价<br /><span>CNY</span></th>
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

async function loadProducts() {
  const button = $("#loadProducts");
  setBusy(button, true);
  try {
    const params = new URLSearchParams({
      storeId: selectedStoreId(),
      limit: "100",
      query: $("#productSearch").value.trim(),
    });
    const data = await api(`/api/ozon/product-dashboard?${params}`);
    state.productRows = data.products || [];
    updateProductCounts(data.counts || {});
    renderProducts();
    showResponse(data);
    toast("商品已读取");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
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
  const stocked = products.filter((item) => Number(item.fbs_stock ?? item.stock ?? 0) > 0);
  return {
    products,
    actionQueue,
    selling,
    reviewing,
    archived,
    priced,
    stocked,
  };
}

function productAssetIssues(item = {}) {
  const issues = [];
  const stock = Number(item.fbs_stock ?? item.stock ?? 0);
  const price = Number(item.price || 0);
  if (["error", "needFix"].includes(item.status_group) || item.status === "error") issues.push(item.status_group === "needFix" ? "待修改" : "审核/状态错误");
  if (item.errors?.length) issues.push(`错误 ${item.errors.length}`);
  if (stock <= 0 && !["archived", "delisted"].includes(item.status_group)) issues.push("缺库存");
  if (price <= 0 && !["archived", "delisted"].includes(item.status_group)) issues.push("缺价格");
  if (item.reasons?.length) issues.push("有失败原因");
  return [...new Set(issues)];
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
  const price = item.price ? `${formatMoney(item.price)} ${item.currency_code || ""}`.trim() : "未定价";
  const stock = item.fbs_stock ?? item.stock ?? 0;
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
        <span>FBS ${escapeHtml(String(stock))}</span>
      </div>
      <p>${escapeHtml(issueText)}</p>
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
  const missingPrice = snapshot.products.length - snapshot.priced.length;
  const missingStock = snapshot.products.length - snapshot.stocked.length;
  const currentProductTask = latestCurrentProductTask();
  summary.innerHTML = [
    renderCurrentProductTaskReminder(currentProductTask, { placement: "products" }),
    productAssetCard("商品总数", snapshot.products.length, "当前已加载 Ozon 商品资产", "info"),
    productAssetCard("待处理", snapshot.actionQueue.length, "错误、待修改、缺价或缺库存", snapshot.actionQueue.length ? "warning" : "success"),
    productAssetCard("在售商品", snapshot.selling.length, "正在产生经营结果的商品", "success"),
    productAssetCard("缺库存/缺价", `${Math.max(0, missingStock)} / ${Math.max(0, missingPrice)}`, "库存和价格是运营优先级", missingStock || missingPrice ? "warning" : "success"),
    productAssetCard("审核/归档", `${snapshot.reviewing.length} / ${snapshot.archived.length}`, "提交回执和非在售资产分开看", "info"),
  ].join("");

  const groups = [
    ["#productAssetActionQueue", snapshot.actionQueue, "当前没有高优先级商品风险。", "warning"],
    ["#productSellingLedger", snapshot.selling, "当前没有加载到在售商品。", "success"],
    ["#productReviewLedger", snapshot.reviewing, "当前没有待上架或审核中的商品。", "info"],
    ["#productArchivedLedger", snapshot.archived, "当前没有下架或归档商品。", "muted"],
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

  renderProductAssetLedger();
  $("#productsTable").innerHTML = rows.length
    ? rows.map(productRowHtml).join("")
    : "<tr><td colspan=\"9\" class=\"product-empty\">没有匹配的商品。</td></tr>";
}

function productRowHtml(item) {
  const price = item.price ? `${formatMoney(item.price)} ${item.currency_code}` : "-";
  const oldPrice = item.old_price ? `划线价 ${formatMoney(item.old_price)}` : "没有指数";
  const image = item.image
    ? `<img class="product-photo" src="${item.image}" alt="${escapeHtml(item.name)}" />`
    : `<div class="photo-placeholder">＋</div>`;
  const reason = item.reasons?.[0] || item.status_description || "";
  const marker = item.errors?.length ? `错误 ${item.errors.length}` : "添加";

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
        <span class="status-pill ${item.status_group}">${item.status_label}</span>
        <div class="status-sub">${escapeHtml(reason)}</div>
      </td>
      <td><strong>${escapeHtml(marker)}</strong></td>
      <td>
        <div class="price-cell">
          <strong>${price}</strong>
          <span class="price-index">${oldPrice}</span>
        </div>
      </td>
      <td>${item.fbs_stock ?? 0}<div class="status-sub">预留 ${item.reserved ?? 0}</div></td>
      <td>
        <div class="row-actions">
          <button class="icon-button" title="编辑">✎</button>
          <button class="icon-button" title="更多">⋮</button>
        </div>
      </td>
    </tr>
  `;
}

async function loadPromotions() {
  const button = $("#loadPromotions");
  setBusy(button, true);
  try {
    const data = await api(`/api/ozon/actions?storeId=${encodeURIComponent(selectedStoreId())}`);
    state.promotionRows = normalizeOzonList(data, ["actions", "items"]);
    renderPromotions();
    showResponse(data);
    toast(`已读取 ${state.promotionRows.length} 个 Ozon 促销活动`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function renderPromotions() {
  const container = $("#promotionList");
  if (!container) return;
  if (!state.promotionRows.length) {
    container.innerHTML = `<p class="hint">当前店铺没有返回促销活动。</p>`;
    renderPromotionDetail();
    return;
  }
  container.innerHTML = state.promotionRows.map((action) => {
    const id = promotionId(action);
    const selected = id && promotionId(state.selectedPromotion || {}) === id;
    const productCount = action.participating_products_count ?? action.products_count ?? action.product_count ?? "-";
    const candidateCount = action.potential_products_count ?? action.candidates_count ?? action.candidate_count ?? "-";
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
  renderPromotions();
  renderPromotionDetail(true);
  await loadPromotionProducts(actionId);
}

async function loadPromotionProducts(actionId = promotionId(state.selectedPromotion || {})) {
  if (!actionId) return;
  try {
    const [productsData, candidatesData] = await Promise.all([
      api("/api/ozon/actions/products", {
        method: "POST",
        body: JSON.stringify({ storeId: selectedStoreId(), action_id: actionId, limit: 1000 }),
      }),
      api("/api/ozon/actions/candidates", {
        method: "POST",
        body: JSON.stringify({ storeId: selectedStoreId(), action_id: actionId, limit: 1000 }),
      }),
    ]);
    state.promotionProducts = normalizeOzonList(productsData, ["products", "items"]);
    state.promotionCandidates = normalizeOzonList(candidatesData, ["products", "items", "candidates"]);
    showResponse({ products: productsData, candidates: candidatesData });
    renderPromotionDetail();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderPromotionDetail(loading = false) {
  const action = state.selectedPromotion;
  $("#promotionDetailTitle").textContent = action ? promotionTitle(action) : "请选择一个活动";
  $("#promotionDetailMeta").textContent = action ? `活动 ID ${promotionId(action)} / ${promotionPeriod(action)}` : "可查看正在参加和可加入商品。";
  $("#promotionProductCount").textContent = loading ? "读取中" : String(state.promotionProducts.length || 0);
  $("#promotionCandidateCount").textContent = loading ? "读取中" : String(state.promotionCandidates.length || 0);
  $("#promotionProductsTabCount").textContent = String(state.promotionProducts.length || 0);
  $("#promotionCandidatesTabCount").textContent = String(state.promotionCandidates.length || 0);
  $("#promotionStatus").textContent = action?.is_participating === true ? "已参加" : (action?.status || action?.state || "-");
  $("#removePromotionProducts").disabled = !action || state.promotionProducts.length === 0;
  renderPromotionProductRows();
}

function renderPromotionProductRows() {
  const rows = state.promotionProductKind === "candidates" ? state.promotionCandidates : state.promotionProducts;
  const body = $("#promotionProductRows");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">暂无数据</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((item) => {
    const productId = item.product_id || item.id || item.productId || "";
    const price = item.price || item.current_price || item.old_price || item.max_action_price || "";
    const actionPrice = item.action_price || item.discount_price || item.max_action_price || item.min_price || "";
    const discount = item.discount || item.discount_percent || item.discount_value || "";
    return `
      <tr>
        <td>${escapeHtml(productId)}</td>
        <td>${escapeHtml(item.offer_id || item.offerId || "-")}</td>
        <td>${escapeHtml(item.name || item.title || "-")}</td>
        <td>${price ? escapeHtml(price) : "-"}</td>
        <td>${actionPrice ? escapeHtml(actionPrice) : "-"}</td>
        <td>${discount ? escapeHtml(discount) : "-"}</td>
        <td>${escapeHtml(item.status || item.state || item.action_status || "-")}</td>
      </tr>
    `;
  }).join("");
}

async function removePromotionProducts() {
  const actionId = promotionId(state.selectedPromotion || {});
  const productIds = state.promotionProducts
    .map((item) => item.product_id || item.id || item.productId)
    .map((id) => Number(id))
    .filter(Boolean);
  if (!actionId || !productIds.length) {
    toast("当前活动没有可删除的活动商品", "error");
    return;
  }
  const title = promotionTitle(state.selectedPromotion);
  const ok = window.confirm(`确认从活动「${title}」中删除 ${productIds.length} 个商品吗？这个动作会真实提交到 Ozon。`);
  if (!ok) return;
  const button = $("#removePromotionProducts");
  setBusy(button, true);
  try {
    const data = await api("/api/ozon/actions/products/deactivate", {
      method: "POST",
      body: JSON.stringify({ storeId: selectedStoreId(), action_id: actionId, product_ids: productIds }),
    });
    showResponse(data);
    toast("已提交删除活动商品请求");
    await loadPromotionProducts(actionId);
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

function selectedWorkflowRun() {
  return state.workflowRuns.find((run) => run.id === state.selectedWorkflowRunId) || state.workflowRuns[0] || null;
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
    if (!state.selectedWorkflowRunId && state.workflowRuns.length) {
      state.selectedWorkflowRunId = state.workflowRuns[0].id;
    }
    if (!state.workflowRuns.some((run) => run.id === state.selectedWorkflowRunId)) {
      state.selectedWorkflowRunId = state.workflowRuns[0]?.id || "";
      state.selectedWorkflowNodeKey = "";
    }
    renderWorkflowConsole();
    renderCockpitDashboard();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderWorkflowRunList(run) {
  const list = $("#workflowRunList");
  if (!list) return;
  if (!state.workflowRuns.length) {
    list.innerHTML = `<p class="hint">暂无工作流记录。跑一次自动上架后，这里会显示每个节点。</p>`;
    return;
  }
  const filteredRuns = state.workflowRuns.filter((item) => workflowRunMatchesFilter(item, state.workflowFilter));
  list.innerHTML = `
    <h2>运行记录</h2>
    <p class="hint">当前筛选：${escapeHtml(state.workflowFilter)} · ${filteredRuns.length}/${state.workflowRuns.length} 条</p>
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
  const summary = state.workflowSummary || {};
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
      <small>${escapeHtml((summary.topNextActions || [])[0]?.action || "暂无推荐动作")}</small>
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
  return `
    <article class="workflow-payload-issue" title="${escapeHtml(issue.message || issue.code || "问题")}">
      <div class="workflow-payload-issue-main">
        <span>#${index + 1}</span>
        <strong>${escapeHtml(issue.code || "UNKNOWN")}</strong>
        <small>定位字段：${escapeHtml(meta.label)}</small>
      </div>
      ${workflowPayloadRepairTemplate(issue, payload)}
      <div class="workflow-payload-issue-actions">
        <button class="ghost" type="button" data-payload-path="${escapeHtml(meta.path)}" data-payload-label="${escapeHtml(meta.label)}">定位字段</button>
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

function renderRequiredAttributeManualBacklog(run = {}, node = {}) {
  const backlog = run.payloadDraftValidation?.requiredAttributeManualBacklog || node?.output?.requiredAttributeManualBacklog || null;
  if (!backlog || !Number(backlog.totalCount || 0)) return "";
  const buckets = Array.isArray(backlog.buckets) ? backlog.buckets : [];
  return `
    <div class="required-attribute-manual-backlog">
      <div>
        <strong>高频人工属性</strong>
        <small>${escapeHtml(backlog.readinessStatus || "manual_review")} · ${Number(backlog.totalCount || 0)} 项</small>
      </div>
      <p>${escapeHtml(backlog.safeNextAction || "人工处理后重新预检；不会自动提交 Ozon。")}</p>
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
      ${renderRequiredAttributeManualBacklog(run, node)}
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
                </div>
                <div>
                  <span>${escapeHtml(requiredFillPlanActionText(row.action))}</span>
                  ${row.value ? `<code>${escapeHtml(row.value)}</code>` : ""}
                  ${row.dictionaryValueId ? `<small>字典 #${escapeHtml(row.dictionaryValueId)}</small>` : ""}
                  ${renderRequiredFillPlanCandidates(row)}
                </div>
                <p>${escapeHtml(row.reasonZh || "修复后重新预检；不会自动提交 Ozon。")}</p>
                <p>${escapeHtml(row.safeNextStep || "修复后重新预检；不会自动提交 Ozon。")}</p>
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

function renderVariantRepairSuggestions(row = {}) {
  const suggestions = Array.isArray(row.repairSuggestions) ? row.repairSuggestions : [];
  if (!suggestions.length) return "";
  return `
    <div class="variant-repair-suggestions">
      <strong>只读修复建议</strong>
      ${suggestions.map((suggestion) => `
        <span>${escapeHtml(suggestion.title || suggestion.code || "修复建议")}：${escapeHtml(suggestion.action || "")}</span>
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
        <span>SKU 图区分 ${Number(summary.uniqueSkuImageRowCount || 0)}/${Number(summary.rowCount || rows.length)}，缺图 ${Number(summary.missingSkuImageRowCount || 0)}，未区分 ${Number(summary.nonUniqueSkuImageRowCount || 0)}</span>
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
                <td><code>${escapeHtml(row.offerId || "-")}</code></td>
                <td>${escapeHtml(row.modelName || "未读取")}</td>
                <td>${(row.aspects || []).length
                  ? (row.aspects || []).map((aspect) => `<span>${escapeHtml(aspect.name || `属性 ${aspect.id || ""}`)}：${escapeHtml(aspect.value || "空")}</span>`).join("")
                  : "缺少可变特性"}</td>
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
  const commissionRateText = Number(pricingDiagnosis.commissionRate || 0)
    ? `${Math.round(Number(pricingDiagnosis.commissionRate || 0) * 1000) / 10}%`
    : "-";
  const money = (value) => Number(value || 0).toFixed(2).replace(/\.00$/, "");
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
        <article><span>运费等级</span><strong>${escapeHtml(level.name || "-")}</strong><small>运费 ${money(pricingDiagnosis.logisticsFee)}</small></article>
        <article><span>佣金</span><strong>${money(pricingDiagnosis.commission)}</strong><small>${escapeHtml(commissionRateText)} · ${escapeHtml(commissionSource.label || "手填/默认佣金率")}</small></article>
        <article><span>利润</span><strong>${money(pricingDiagnosis.profit)}</strong><small>目标 ${Math.round(Number(pricingDiagnosis.profitRate || 0) * 100)}%</small></article>
      </div>
      <div class="workflow-pricing-foot">
        <span>尺重：${Number(packageInfo.weightG || 0)}g / ${Number(packageInfo.lengthMm || 0)}×${Number(packageInfo.widthMm || 0)}×${Number(packageInfo.heightMm || 0)}mm</span>
        <span>成本基数：${money(pricingDiagnosis.baseCost)}</span>
        <span>原价策略：${escapeHtml(oldPriceSource.label || "旧规则：售价乘以 2")}</span>
        <span>利润底线：${marginFloor.floorCny ? `${money(marginFloor.floorCny)} CNY` : "未配置"}</span>
        <span>佣金来源：${escapeHtml(commissionSource.source || "manual_default")} / ${escapeHtml(commissionSource.confidence || "low")}</span>
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
  detail.innerHTML = `
    <div class="workflow-section-head">
      <div>
        <h2>${escapeHtml(node.title || workflowNodeTitle(node.key))}</h2>
        <p class="hint">${escapeHtml(node.key)}</p>
      </div>
      <div class="workflow-detail-head-actions">
        <button class="ghost" data-workflow-action="copy-run-summary">复制工作流摘要</button>
        <span class="workflow-status workflow-status-${escapeHtml(node.status || "pending")}">${workflowStatusLabel(node.status)}</span>
      </div>
    </div>
    <div class="workflow-actions">
      <button class="ghost" data-workflow-action="pause">暂停</button>
      <button class="ghost" data-workflow-action="resume">恢复</button>
      <button class="primary" data-workflow-action="retry">重试节点</button>
      <button class="primary" data-workflow-action="continue-node">从此继续</button>
      <button class="primary" data-workflow-action="controlled-chain">受控跑到总闸</button>
    </div>
    ${run.status === "waiting_human" || run.locks?.waitingHuman ? `
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
      <button class="danger" data-workflow-action="submit-payload-draft">确认提交 Ozon</button>
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
  toast(result.ok ? "Payload 校验通过" : `Payload 有 ${result.issues?.length || result.errors?.length || 0} 个问题`, result.ok ? "ok" : "error");
  await loadWorkflowRuns();
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
        note: "页面人工选择：属性矩阵字典值修复",
      }),
    });
    toast(result.ok ? "本地草稿已写回并通过预检，不会提交 Ozon" : "本地草稿已写回，但预检仍有问题", result.ok ? "ok" : "error");
    await loadWorkflowRuns();
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
    return;
  }
  if (action === "apply-variant-text-repair") {
    const value = window.prompt("请输入要写回本地 Payload 草稿的变体文本值。系统会重新预检，但不会提交 Ozon。", "");
    if (value === null) return;
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
        note: "页面人工输入：变体文本属性修复",
      }),
    });
    toast(result.ok ? "本地变体文本已写回并通过预检，不会提交 Ozon" : "本地变体文本已写回，但预检仍有问题", result.ok ? "ok" : "error");
    await loadWorkflowRuns();
    return;
  }
  if (action === "submit-payload-draft") {
    const ok = window.confirm("确认提交 Ozon 会调用 /v3/product/import。请确认 Payload 已校验通过且风险可接受，是否继续？");
    if (!ok) return;
    await saveWorkflowPayloadDraft(run.id, $("#workflowPayloadEditor")?.value || "{}");
    const result = await api(`/api/workflows/${encodeURIComponent(run.id)}/payload-draft/submit`, {
      method: "POST",
      body: JSON.stringify({ confirmSubmit: true, storeId: selectedStoreId() }),
    });
    toast(result.ok ? `已提交 Ozon task：${result.taskId || "-"}` : (result.message || "Payload 未提交"), result.ok ? "ok" : "error");
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
    const data = await api(`/api/ozon/description-categories?storeId=${encodeURIComponent(selectedStoreId())}`);
    state.categoryTree = data.result || [];
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
      body: JSON.stringify({ storeId: selectedStoreId() }),
    });
    const treeData = await api(`/api/ozon/description-categories?storeId=${encodeURIComponent(selectedStoreId())}`);
    state.categoryTree = treeData.result || [];
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
      body: JSON.stringify({ product, limit: 8 }),
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
    const data = await api(`/api/ozon/description-categories?storeId=${encodeURIComponent(selectedStoreId())}`);
    state.categoryTree = data.result || [];
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
        description_category_id: descriptionCategoryId,
        type_id: typeId,
      }),
    });
    const attributes = data.result || [];
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

function attributeInputHtml(item) {
  const name = item.name || item.attribute_name || "未命名属性";
  const required = item.is_required ? "<b>*</b> " : "";
  const value = item.type === "Integer" || item.type === "Decimal" ? "1" : "";
  return `
    <div class="attribute-form-row" data-attribute-id="${item.id}" data-complex-id="${item.attribute_complex_id || 0}" data-attribute-type="${item.type || "String"}">
      <label>${required}${escapeHtml(name)} <span class="status-sub">ID ${item.id}</span></label>
      <div class="attribute-value-combobox">
        <input class="listing-attribute-input"
          data-attribute-id="${item.id}"
          data-complex-id="${item.attribute_complex_id || 0}"
          data-attribute-type="${item.type || "String"}"
          value="${value}"
          placeholder="${escapeHtml(item.description || name)}" />
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
  const button = $("#submitListing");
  setBusy(button, true);
  try {
    const variants = collectListingVariants();
    const items = await prepareListingItemsForOzon(buildListingItemsFromForm());
    const data = await api("/api/ozon/product-import", {
      method: "POST",
      body: JSON.stringify({
        storeId: selectedStoreId(),
        items,
      }),
    });
    const taskId = data.result?.task_id || data.task_id;
    if (taskId) $("#listingTaskId").value = taskId;
    applySubmittedStatusToRows(items, taskId);
    const stockQueue = taskId ? await enqueueListingStockQueue(taskId, variants) : null;
    await saveListingDraft("published", { taskId, stockQueueId: stockQueue?.job?.id || "" });
    showResponse(stockQueue ? { productImport: data, stockQueue } : data);
    toast(taskId ? `已提交 ${items.length} 个上架任务商品：${taskId}，库存队列已创建` : `已提交 ${items.length} 个上架商品`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
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
  await loadCaptureBox();
  toast(status === "published" ? "已保存发布记录" : "草稿已保存");
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
      }),
    });
    applyImportInfoToVariantRows(data, taskId);
    const productIds = productIdsFromImportInfo(data);
    let barcodeResult = null;
    if (productIds.length) {
      barcodeResult = await generateOzonBarcodes(productIds);
    }
    showResponse(barcodeResult ? { importInfo: data, barcodeGenerate: barcodeResult } : data);
    await saveListingDraft("published", { taskId, checkedAt: new Date().toISOString() });
    toast(barcodeResult ? "任务结果已读取，条形码已请求生成" : "任务结果已读取");
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
    body: JSON.stringify({
      storeId: selectedStoreId(),
      product_ids: productIds,
    }),
  });
}

async function readStock() {
  const button = $("#readStock");
  setBusy(button, true);
  try {
    const offerId = $("#stockOfferId").value.trim();
    const data = await api("/api/ozon/product-stocks", {
      method: "POST",
      body: JSON.stringify({
        storeId: selectedStoreId(),
        filter: {
          offer_id: offerId ? [offerId] : [],
          visibility: "ALL",
        },
        limit: 10,
      }),
    });
    const items = data.items || data.result?.items || [];
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
    $("#stockTable").innerHTML = rows.length
      ? rows.join("")
      : "<tr><td colspan=\"5\">没有库存数据。</td></tr>";
    showResponse(data);
    toast("库存已读取");
  } catch (error) {
    toast(error.message, "error");
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
      body: JSON.stringify({ limit: 10 }),
    });
    showResponse(data);
    await loadStockQueue();
    toast(`已回放 ${data.replayed || 0} 个可重试库存失败`);
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
  const statusLabel = stockQueueStatusLabel(job.status);
  const safeNextAction = recommendation.safeNextAction || (job.status === "failed" ? "查看失败原因后决定是否回放，不会直接盲写库存。" : "等待库存队列按商品就绪状态继续。");
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
        <span>${escapeHtml(job.reasonCode || "等待执行")}</span>
      </div>
      ${job.lastError ? `<p class="stock-queue-error">最后失败：${escapeHtml(job.lastError)}</p>` : ""}
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
  };
  return map[status] || status || "未知";
}

async function submitJsonTextarea(button, textarea, path, payloadKey) {
  setBusy(button, true);
  try {
    const items = JSON.parse(textarea.value);
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({
        storeId: selectedStoreId(),
        [payloadKey]: items,
      }),
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
    if (header) {
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
    const header = Array.from(view.children).find((child) => child.matches("header.page-head"));
    if (ownership) {
      ownership.insertAdjacentElement("afterend", section);
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
    const visibleBase = new Set(["page-head", "view-ownership-bar", "tab-task-card", "tab-primary-panel"]);
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
    const taskCard = view.querySelector(".tab-task-card");
    if (taskCard) taskCard.insertAdjacentElement("afterend", button);
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

function bindApplicationNavigation() {
  document.querySelectorAll("[data-nav-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupKey = button.dataset.navGroup;
      const panel = document.querySelector(`[data-nav-group-panel="${groupKey}"]`);
      if (!panel) return;
      const activeTab = panel.querySelector(".tab");
      if (activeTab) activeTab.click();
    });
  });
  on("#mobileNavToggle", "click", () => toggleMobileNavigation());
  on("#sidebarBackdrop", "click", () => toggleMobileNavigation(false));
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
  if (!confirm("确定将该商品上架到当前选择的店铺？")) return;
  setBusyText("正在上架到 Ozon...");
  try {
    var data = await api("/api/ozon-learning/complete-listing", {
      method: "POST",
      body: JSON.stringify({ jobId: jobId, storeId: storeId }),
    });
    if (data.ok && data.ok === true) {
      toast("上架成功！SKU: " + (data.sku || "-"));
    } else if (data.ok === false) {
      toast("上架失败: " + (data.error || JSON.stringify(data)), "error");
    } else {
      toast("上架结果: " + JSON.stringify(data));
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusyText(false);
    await loadAutoListJobs();
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
  on("#storeSelect", "change", () => {
    updateStoreHint();
    refreshActiveStoreView();
    obsSetContext();
  });
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
    on("#refreshDashboard", "click", async () => {
      await testApi();
    await loadOrders();
    });
    on("#loadWarehouses", "click", loadWarehouses);
  on("#loadOrders", "click", loadOrders);
  on("#orderWarehouse", "change", loadOrders);
  on("#orderService", "change", renderOrders);
  on("#orderSearch", "keydown", (event) => {
    if (event.key === "Enter") loadOrders();
  });
  document.querySelectorAll("#orderStatusTabs .product-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#orderStatusTabs .product-tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.orderStatus = tab.dataset.status;
      loadOrders();
    });
  });
  on("#loadProducts", "click", loadProducts);
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
  on("#rebuildListingDraft", "click", () => rebuildListingDraftFromCurrentCategory({ preserveText: true, save: true }));
  on("#submitListing", "click", submitListing);
  on("#saveListingDraft", "click", () => saveListingDraft("draft"));
  on("#saveAndSubmitListing", "click", saveAndSubmitListing);
  on("#backToCaptureBox", "click", backToCaptureBox);
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
  on("#loadStockQueue", "click", loadStockQueue);
  on("#replayStockQueue", "click", replayStockQueueFailures);
  on("#submitPrices", "click", () =>
    submitJsonTextarea($("#submitPrices"), $("#priceJson"), "/api/ozon/prices", "prices")
  );
  on("#submitStocks", "click", () =>
    submitJsonTextarea($("#submitStocks"), $("#stockJson"), "/api/ozon/warehouse-stocks", "stocks")
  );
  on("#collect1688", "click", collect1688);
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
  btn.textContent = "一键全自动流水线";
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
  $("#workflowRunList")?.addEventListener("click", (event) => {
    const card = event.target.closest(".workflow-run-card");
    if (!card) return;
    state.selectedWorkflowRunId = card.dataset.runId || "";
    state.selectedWorkflowNodeKey = "";
    renderWorkflowConsole();
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

init().catch((error) => toast(error.message, "error"));
