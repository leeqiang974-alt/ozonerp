# Ozon ERP 统一采集助手

这是 Chrome / Edge 浏览器扩展，用于统一处理 1688、拼多多货源采集和 Ozon 前台竞品采集任务，并发送到 Ozon ERP。

## 安装

1. 打开 Chrome 或 Edge 的扩展程序页面。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择这个目录：`browser-extension/erp-collector-extension`。

## 使用

1. 默认连接本机 ERP：`http://127.0.0.1:5178/`。如使用外部部署，在扩展弹窗的“ERP 连接”中填写 HTTPS 地址。
2. 外部部署若启用了会话认证，在 Token 输入框填写短期会话 Token。Token 只放在浏览器当前会话的 `storage.session`（浏览器不支持时仅保存在 worker 内存），不会写入 `storage.local`、页面日志或 worker 状态；保存后输入框会清空。
3. 在浏览器里登录 1688、拼多多和 Ozon。
4. 打开 1688 商品详情页，可点击「采集当前商品」手动入箱。
5. 打开拼多多商品详情页，可点击页面右下角的 PDD 采集浮层手动入箱。
6. 打开 Ozon 前台页面后，插件后台会领取 ERP 下发的 Ozon 搜索/详情采集任务。
7. 点击扩展里的「立即检查任务」可以手动唤醒后台 worker。

worker 的 heartbeat、next、resume 和 result 请求都会由后台统一附带 `Authorization: Bearer <session token>`；页面脚本不能覆盖该 header。外部地址只允许 HTTPS，HTTP 仅允许本机回环地址。

## 当前采集内容

- 页面 URL
- 商品标题
- 页面 HTML
- 页面图片
- 由 ERP 后端解析出的 SKU 变体、SKU 图片、SKU 价格、商品详情、商品属性、尺重
- 拼多多商品标题、价格、图片、可见 SKU/规格、属性和页面验证状态
- Ozon 搜索结果、详情页标题、图片、类目、属性、描述等竞品反哺信息

如果 1688 页面结构调整，主要调整 ERP 后端的 `src/collector1688.js` 解析规则。
如果拼多多页面结构调整，主要调整 ERP 后端的 `src/collectorPdd.js` 和扩展 `content.js` 的可见字段提取规则。
