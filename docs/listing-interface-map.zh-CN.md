# 上品界面与 Ozon 接口映射

## 店铺和类目

- 店铺：本地 `ozonapi.txt` 店铺配置。
- 平台分类：`/v1/description-category/tree`，固定 `language=ZH_HANS`。
- 类目属性：`/v1/description-category/attribute`，固定 `language=ZH_HANS`。
- 属性值下拉：`/v1/description-category/attribute/values`，固定 `language=ZH_HANS`。

## 产品属性

界面里的品牌、型号、关键词、重量、用途、材质、国家等字段，本质都要进入 `/v3/product/import` 的 `attributes` 数组。

结构：

```json
{
  "id": 85,
  "complex_id": 0,
  "values": [{ "value": "无品牌" }]
}
```

不同 Ozon 类目的必填属性不同，所以 ERP 必须先读取属性，再生成表单。

## 描述

普通文字描述和 JSON 富描述暂作为 ERP 字段保留。Ozon 富内容后续可以对接商品内容相关接口或写入上架 JSON 中的对应字段。

## 图片和视频

- 新品上架主图和图片：`/v3/product/import` 的 `images` 字段，第一张作为主图。
- 已有商品换图：`/v1/product/pictures/import`。
- 视频链接：如果 1688 采集到视频 URL，则写入 `/v3/product/import` 的属性数组：
  - `21841` / `complex_id: 100001`：Ozon 视频链接。
  - `21837` / `complex_id: 100001`：视频标题。
  - `22273` / `complex_id: 100001`：视频展示的商品 offer_id。

## 变体设置

当前先支持单变体行：

- `offer_id`
- 售价、划线价、最低价
- 重量、长宽高
- 颜色/规格

提交商品：`/v3/product/import`。

商品审核通过后：

- 改价：`/v1/product/import/prices`
- FBS 仓库库存：`/v2/products/stocks`

## 任务检查

上架后 Ozon 返回 `task_id`，用 `/v1/product/import/info` 检查审核结果、错误和警告。
