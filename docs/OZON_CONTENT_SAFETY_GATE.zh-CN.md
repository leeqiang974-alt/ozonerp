# Ozon 内容安全门禁

## 触发背景（2026-09-02）

`OZ1D23E83C94` 收到 Ozon `DESCRIPTION_DECLINE`：商品外观或内容传播非传统性关系/LGBT 宣传，禁止销售。复核同卡素材后确认：共享图片包含跨性别旗帜、`trans rights are human rights`、`respect trans women` 等文字；标题、描述和主题标签也含彩虹/相关符号。该类问题不能靠只改描述恢复，已创建商品必须归档。

## 执行规则

1. 上架预检扫描标题、描述、主题标签、富内容和其他属性；命中 `LGBT/pride/trans/rainbow/彩虹/跨性别/性少数/非二元` 等线索即硬阻断，禁止自动改写后重提。
2. 图片 OCR 同时使用可用的中文、英语和俄语 Windows OCR；命中 `prohibited_lgbt_symbolism` 的图片从草稿/翻译队列排除，并保留 OCR 证据和排除原因。OCR 不可用时不能把“未识别”当作合规结论。
3. AI 生图分析必须标出 `content_safety.prohibited_lgbt_symbolism`；命中后禁止调用付费生图。未命中时，所有生图提示仍明确禁止生成或强化相关旗帜、符号、口号和身份宣传。
4. Ozon 已创建商品使用官方 `POST /v1/product/archive`；随后必须用 `/v3/product/info/list` 回读 `is_archived=true`，才将本地草稿设为 `archived` 并停止自动重提/库存回写。
5. 平台返回“未创建”或 Ozon 回读不存在时，只保留审计和源证据；不得虚构“已归档”。

## 已验证处置

- Ozon 实际回读：同卡 3 个仍存在变体 `6179582062`、`6179582066`、`6179582101` 归档后均为 `is_archived=true`、`UNAVAILABLE`。
- 被拒变体 `6179582127` 在回读时已不存在，不能再向其发送归档请求。
- 草稿 `#825` 已同步为 `archived` / `stock_sync_status=archived`。

## 回归验证

运行：

```powershell
$env:PYTHONPATH='backend'
pytest -q backend/tests/test_quality_preflight.py backend/tests/test_ozon_seller.py backend/tests/test_local_ocr_policy_gate.py backend/tests/test_visual_image_service.py
```

预期：文本预检硬阻断、OCR 排除理由可审计、归档请求按 ID 去重、AI 生图提示含禁止规则。
