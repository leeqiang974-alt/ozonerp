# Ozon ERP 统一采集助手

这是 Chrome / Edge 浏览器扩展，用于统一处理 1688 货源采集和 Ozon 前台竞品采集任务，并发送到本地 ERP。

## 安装

1. 打开 Chrome 或 Edge 的扩展程序页面。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择当前项目目录：`browser_extension/erp-collector-extension`。

## 使用

1. 确认本地 ERP 正在运行：`http://localhost:5178/`。
2. 在浏览器里登录 1688 和 Ozon。
3. 打开 1688 商品详情页，可点击「采集当前商品」手动入箱。
4. 打开 Ozon 前台页面后，插件后台会领取 ERP 下发的 Ozon 搜索/详情采集任务。
5. 点击扩展里的「立即检查任务」可以手动唤醒后台 worker。

## 当前采集内容

- 页面 URL
- 商品标题
- 页面 HTML
- 页面图片
- 由 ERP 后端解析出的 SKU 变体、SKU 图片、SKU 价格、商品详情、商品属性、尺重
- Ozon 搜索结果、详情页标题、图片、类目、属性、描述等竞品反哺信息
- Ozon 列表卡片浮层：评分、评价、页面可见尺重/销量提示；所有页面提示均标记为 `capture_hint`
- Ozon 详情页尺重统一为 `weightG`、`lengthMm`、`widthMm`、`heightMm`，缺失时不填默认值

如果 1688 页面结构调整，主要调整 ERP 后端的 `src/collector1688.js` 解析规则。
