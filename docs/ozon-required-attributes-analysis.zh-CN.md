# Ozon 必填属性字典分析自动化

更新时间：2026-06-27

## 目标

把 Ozon 分类树下每个 `description_category_id/type_id` 的必填属性、字典属性、变体属性跑成结构化分析文件，为后续自动上架的属性填写逻辑反哺。

输出文件：

```text
data/ozon-required-attribute-analysis.json
```

## 当前产物

当前已完成全局刷新并生成分析：

| 指标 | 数量 |
|---|---:|
| 分类 type 总数 | 7422 |
| 已缓存属性的 type | 7422 |
| 未缓存属性的 type | 0 |
| 必填属性行 | 27394 |
| 唯一必填属性 | 62 |
| 必填字典属性行 | 16797 |
| 已缓存字典值行 | 16797 |

当前策略分布：

| 策略 | 行数 |
|---|---:|
| `dictionary_lookup_from_product_text` | 7551 |
| `fixed_no_brand` | 7418 |
| `model_name_from_parent_sku` | 7612 |
| `dictionary_lookup_or_manual_rule` | 788 |
| `variant_aspect_from_sku` | 1128 |
| `manual_rule_needed` | 2135 |
| `package_data` | 316 |
| `fixed_country_china` | 446 |

## 填写策略

分析器会把必填属性归纳为以下策略：

| 策略 | 填写逻辑 |
|---|---|
| `fixed_no_brand` | 品牌字段默认填“无品牌/Нет бренда”，除非货源明确品牌且允许使用 |
| `model_name_from_parent_sku` | 型号名称用父 SKU/商品族名生成，支撑 Ozon 合并同一卡片 |
| `fixed_country_china` | 生产国/制造国默认中国，优先匹配 Ozon 字典值 |
| `variant_aspect_from_sku` | 颜色、尺码等可变特性从 1688 SKU 规格提取，避免同组 SKU 特征重复 |
| `dictionary_lookup_from_product_text` | 材质、类型、用途等从标题、1688 参数、Ozon 学习样本文本匹配字典值 |
| `dictionary_lookup_or_manual_rule` | 已知是字典属性，但暂缺稳定自动映射，需要继续积累规则 |
| `package_data` | 重量/尺寸从 1688 详情尺重解析，缺失时阻塞 |
| `generated_content` | 描述、关键词、营销文本由俄文内容生成 |
| `manual_rule_needed` | 暂无可靠自动规则，进入人工规则池 |

## 命令

只基于本地缓存生成分析，不调用 Ozon：

```bash
npm run analyze:ozon-required-attributes
```

小批量刷新缺失的类目属性：

```bash
npm run analyze:ozon-required-attributes -- --refresh-attributes --limit=50 --throttle-ms=350
```

小批量刷新必填字典值：

```bash
npm run analyze:ozon-required-attributes -- --refresh-values --limit=50 --throttle-ms=350
```

全量刷新建议按批次执行，不建议一次性无间隔跑完：

```bash
npm run analyze:ozon-required-attributes -- --refresh-attributes --limit=300 --throttle-ms=500
npm run analyze:ozon-required-attributes -- --refresh-values --limit=300 --throttle-ms=500
```

脚本会优先跳过已经缓存过的属性和字典值，所以可以重复执行、断点续跑。

## 安全边界

- 该自动化只读取 Ozon 分类/属性/字典接口并写本地 JSON。
- 不创建商品、不提交 Payload、不改库存、不触发审核。
- 全量刷新有 API 调用量和限流风险，应分批执行。
- 分析结果是自动填写规则的知识库，不代表每个属性都能直接无人工上架。
