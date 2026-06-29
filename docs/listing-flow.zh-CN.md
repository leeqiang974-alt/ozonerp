# Ozon FBS 产品上架逻辑

## 核心原则

产品上架不是单独创建商品，而是以下链路：

1. 读取中文类目树：`/v1/description-category/tree`，固定 `language=ZH_HANS`。
2. 选中叶子类型，得到 `description_category_id` 和 `type_id`。
3. 读取该类型的中文属性：`/v1/description-category/attribute`，固定 `language=ZH_HANS`。
4. 按必填属性组装 `attributes`。
5. 提交商品：`/v3/product/import`，返回 `task_id`。
6. 查询任务结果：`/v1/product/import/info`。
7. 商品通过后，再独立设置价格和仓库库存。

## ERP 模块拆分

- 产品上架：负责商品基础资料、图片、类目、属性和导入任务。
- 价格：独立使用 `/v1/product/import/prices`。
- 仓库库存：独立使用 `/v2/products/stocks`。
- FBS 订单：独立使用 `/v3/posting/fbs/list`。

## 上架数据结构

`/v3/product/import` 的最小业务结构：

```json
{
  "items": [
    {
      "offer_id": "本地SKU",
      "name": "商品名称",
      "description_category_id": 17027929,
      "type_id": 95309,
      "price": "99",
      "old_price": "199",
      "currency_code": "CNY",
      "vat": "0",
      "weight": 500,
      "weight_unit": "g",
      "depth": 200,
      "width": 150,
      "height": 80,
      "dimension_unit": "mm",
      "images": ["https://example.com/image.jpg"],
      "attributes": [
        {
          "id": 85,
          "complex_id": 0,
          "values": [{ "value": "无品牌" }]
        }
      ]
    }
  ]
}
```

## 审核失败处理

Ozon 通常不会在提交时立即告诉所有错误，而是在任务结果里返回。ERP 应保存：

- `task_id`
- `offer_id`
- 提交 JSON
- Ozon 返回的错误和警告
- 修复后的再次提交记录

下一步适合做“上架模板”：按常用类目保存必填属性，减少每次手填。
