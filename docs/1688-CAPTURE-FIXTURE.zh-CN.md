# 1688 快照 fixture 导入与回放

这是一个离线证据入口，不是 1688 抓取器，也不执行 Ozon 操作。浏览器扩展完成一次人工允许的 1688 商品采集后，可以把脱敏的 `manifest.json` 与 `page.html` 放到本地目录，再用统一回放器核对身份、页面 SHA-256 和解析状态。

目录最小结构：

```text
my-capture/
  manifest.json
  page.html
```

`manifest.json` 至少包含：

```json
{
  "fixtureKind": "real_redacted_capture",
  "synthetic": false,
  "redacted": true,
  "verificationLevel": "locally_tested_fixture",
  "captureOrigin": "real_browser_capture",
  "url": "https://detail.1688.com/offer/…html",
  "hints": {
    "taskId": "capture-task-id",
    "capturedAt": "2026-07-19T00:00:00.000Z",
    "captureMode": "browser_extension"
  },
  "validationTargets": ["sku_matrix", "package_weight"]
}
```

运行：

```powershell
npm.cmd run replay-1688-capture -- .\my-capture
```

输出只包含脱敏解析摘要、manifest/page 哈希、身份核对和阻塞原因；原始页面不会写入 ERP 数据，也不会上传或请求外网。`real_redacted_capture` 只表示页面来源于真实浏览器采集，回放验证仍是 `locally_tested_fixture`，不能升级为 Ozon `real_read_verified`，更不能视为已上架。验证码、登录失效或来源字段不完整时，回放会保持 `needs_review`/失败，不能绕过人工处理。

## 从 capture 回放到类目/必填属性预检

`src/goldenPathReplay.js` 的 `replay1688CaptureToOzonPreflight` 与
`replay1688ToOzonPreflight` 可在离线环境把单商品快照继续回放到：来源证据 →
SKU/offer 绑定 → 本地类目选择 → 必填属性矩阵 → Payload preflight。类目属性必须作为
`categoryAttributes` 明确传入（可来自 `test/fixtures/ozon/category-read/` 的脱敏 fixture），
字典值通过 `dictionaryValuesByAttributeId` 传入；系统不会从 1688 文本臆造 Ozon 类目或
合法字典值。

回放结果中的 `stages.category.evidence.currentReadObserved` 固定为 `false`，验证等级为
`locally_tested_fixture`。即使本地必填属性预检通过，仍不能据此提交 Ozon；真实提交前必须
用当前店铺 Seller API 读取类目/属性并保存服务端回执，再由卖家确认。

不要把 Cookie、Authorization、请求头、个人信息或未脱敏页面提交到仓库。真实页面若要进入受控验证，应先脱敏，再由人工保存 manifest 中的快照时间、采集模式和验证目标。
