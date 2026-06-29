import { load1688OpenApiConfig } from "../src/open1688Config.js";
import { call1688OpenApi } from "../src/open1688Client.js";

const config = load1688OpenApiConfig();

function redactPath(path) {
  return String(path || "").replace(config.appKey, "[appKey]");
}

function summarize(result) {
  return {
    status: result.status,
    ok: result.ok,
    urlPath: redactPath(result.urlPath),
    errorCode: result.errorCode || "",
    errorMessage: result.errorMessage || "",
    requestId: result.requestId || "",
    sample: String(result.text || "").slice(0, 280),
  };
}

const probes = [
  {
    label: "网关与签名: system/currentTime",
    includeAccessToken: false,
    apiName: "system/currentTime",
  },
  {
    label: "普通商品详情: alibaba.product.get",
    namespace: "com.alibaba.product",
    apiName: "alibaba.product.get",
    params: { productID: "815256646338", webSite: "1688" },
  },
  {
    label: "分销商品详情候选: alibaba.agent.product.get",
    namespace: "com.alibaba.product",
    apiName: "alibaba.agent.product.get",
    params: { productID: "815256646338", webSite: "1688" },
  },
  {
    label: "分销买家商品详情: alibaba.fenxiao.productInfo.get",
    namespace: "com.alibaba.fenxiao",
    apiName: "alibaba.fenxiao.productInfo.get",
    params: { offerId: "815256646338" },
  },
  {
    label: "订单创建权限候选: alibaba.trade.fastCreateOrder",
    namespace: "com.alibaba.trade",
    apiName: "alibaba.trade.fastCreateOrder",
    method: "POST",
    params: { webSite: "1688" },
  },
];

for (const probe of probes) {
  const { label, ...options } = probe;
  const result = await call1688OpenApi(options);
  console.log(JSON.stringify({ label, ...summarize(result) }, null, 2));
}
