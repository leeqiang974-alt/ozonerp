# Ozon 字典属性填写规则与技巧

更新时间：2026-06-27

## 来源

本规则基于三类资料归纳：

- Ozon Seller API：商品导入、`type_id`、类目属性、属性值字典、已上架商品属性回读。
- Ozon Seller 教程/知识库：商品标题、商品卡合并、必填属性、变体填写。
- 俄语卖家经验：商品卡质量、合并失败、属性对搜索/筛选/审核的影响。

同时结合本 ERP 已全量缓存的 Ozon 分类字典：

- 分类 type：7422。
- 必填属性行：27394。
- 必填字典属性行：16797。
- 必填字典值缓存：16797。
- 唯一必填属性：62。

## 总原则

Ozon 字典不是“翻译文本后随便填”，而是“类目 + 商品类型 + 属性”三元组下的合法值选择。

自动上架必须遵守以下顺序：

```text
确定 description_category_id/type_id
  -> 读取该 type 的 attributes
  -> 找出 is_required / is_aspect / dictionary_id
  -> dictionary_id != 0 时只使用 attribute/values 返回的 dictionary_value_id
  -> dictionary_id == 0 时按字段类型填文本/数字/URL
  -> 提交前做 Payload 预检
```

不要跨类目复用 `dictionary_value_id`。同名值在不同字典里也可能不是同一个合法值。

## 高频必填属性规则

| 属性 | 本地频次 | 推荐填写策略 | 说明 |
|---|---:|---|---|
| `8229 类型` | 7422 | `dictionary_lookup_from_product_text` | 几乎所有类目都必填。优先用 Ozon 类目路径、1688 标题、1688 参数和 Ozon 学习样本匹配合法字典值 |
| `85 品牌` | 7118 | `fixed_no_brand` | 1688 无授权品牌时默认无品牌。不要把 1688 店铺名、工厂名、营销词当品牌 |
| `9048 型号名称` | 6974 | `model_name_from_parent_sku` | 同一父 SKU 的变体必须保持一致，用于合并为一张商品卡 |
| `4389 原产国` | 446 | `fixed_country_china` | 1688 跨境货源默认中国，匹配“中国/Китай”字典值 |
| `10096 商品颜色` | 300 | `variant_aspect_from_sku` | 多 SKU 必须从 1688 规格提取不同颜色，否则 Ozon 会判定可变特性重复 |
| `4295/4298 俄罗斯尺码` | 277 | `variant_aspect_from_sku` | 服饰鞋类必须用合法俄码字典值，不能直接塞中文尺码 |
| `8050 成分` | 451 | `manual_rule_needed` | 要从材质/成分文本提取，低置信时人工确认 |
| `9782 产品危险等级` | 323 | `dictionary_lookup_or_manual_rule` | 需要建立类目默认规则；不能随意填危险品值 |
| `23487 制造商` | 446 | `blocked_sensitive` | 无明确可信制造商资料时必须人工确认，不能自动填中国、店铺名或工厂名 |

## 字典值匹配技巧

### 0. 规则沉淀必须先过样本聚合和人工审核

低置信或暂未规则化的必填属性，不能因为当前商品缺值就直接生成自动规则。ERP 现在按三层只读结构沉淀：

1. 当前商品 `requiredAttributeRuleCandidateIndex`：只说明这个类目有哪个属性值得后续规则化。
2. 多商品 `requiredAttributeRuleCandidateHistory`：按 `categoryKey + attributeId` 聚合同类目样本，2 个及以上不同商品/run 出现后才进入 `ready_for_review`。
3. 后续人工审核规则池：只有人工确认规则来源、适用品类、反例和安全边界后，才能进入真实自动填充规则。

此阶段不会持久化规则，也不会把规则池草案默认写入草稿 summary 或 payloadDraftValidation；不会自动写 Payload、不会触发预检或提交。当前商品仍按预检结果人工补齐并重新校验。

### 1. 类型字段优先匹配“产品本体”

`类型` 是最重要的字典字段。匹配优先级：

1. Ozon 学习样本中的同类商品类型。
2. Ozon 中文类目路径和 type 名称。
3. 1688 标题核心词。
4. 1688 参数中的用途/类型/材质。
5. 俄文标题和生成内容。

反例：

- 看到“收纳”就填任何“收纳盒”是不安全的；厨房收纳、浴室收纳、汽车收纳可能是不同字典。
- 看到“钥匙扣”时，要区分纪念品、配饰、汽车配件、宠物玩具等类目。

当前规则引擎只接入了很窄的一版类型同义词候选：

- `Тип` / `Вид` / 用途 / 类型 / 种类 字段中，货源文本含 `organizer`、`收纳盒`、`收纳架`、`整理盒`、`置物架` 时，可在当前类目字典中候选 `органайзер`。
- 候选来源为 `type_synonym`，置信度 `0.7`，只输出到 `dictionaryCandidates`。
- 非类型字段不会触发该规则；候选仍需人工确认和重新预检。

### 1.0.1 颜色字段只做字典候选

`Цвет`、`color`、颜色字段可以从 1688 SKU/标题里读出明显颜色词，但仍不能直接写入 Payload，尤其是多 SKU 商品还要保证整组可变特性不重复。当前规则只做以下候选：

- 货源文本含红/蓝/白/黑/绿/黄/粉/紫/橙/棕/灰/透明等明确颜色词时，只在当前类目当前属性字典中候选对应颜色值。
- 候选来源为 `color_synonym`，置信度 `0.7`，只输出到 `dictionaryCandidates`。
- 非颜色字段不会触发该规则；例如 `特色` 只因为含有单字“色”也不能触发颜色候选。候选必须人工确认、本地草稿写回并重新预检后，才能进入后续提交闸。

### 1.1 用途/适用对象只做窄范围候选

`Назначение`、`Применение`、`Для кого`、用途、适用对象等字段容易和类型字段混淆，不能因为标题里出现某个场景词就直接写入 Payload。当前规则只做以下中置信候选：

- 货源文本含 `厨房` / `kitchen` 时，只在当前类目当前属性字典中候选 `для кухни` 等厨房用途值。
- 货源文本含 `宠物` / `猫` / `狗` / `pet` 时，只在当前类目当前属性字典中候选 `для животных` 等宠物用途值。
- 候选来源为 `purpose_synonym`，置信度 `0.7`，只输出到 `dictionaryCandidates`。
- 非用途/适用对象字段不会触发该规则；候选必须人工确认、本地草稿写回并重新预检后，才能进入后续提交闸。

### 1.2 性别/适用性别只做字典候选

`Пол`、`gender`、性别、适用性别字段可以从标题和 1688 参数里提取明显线索，但仍不能自动写入 Payload。当前规则只做以下候选：

- 货源文本含 `女士` / `女性` / `women` / `female` / `жен` 时，只在当前属性字典中候选 `женский` 等女性值。
- 货源文本含 `男士` / `男性` / `men` / `male` / `муж` 时，只在当前属性字典中候选 `мужской` 等男性值。
- 货源文本含 `儿童` / `kids` / `дет` 时，只在当前属性字典中候选 `детский` 等儿童值。
- 候选来源为 `gender_synonym`，置信度 `0.7`，只输出到 `dictionaryCandidates`；非性别字段不会触发。

### 1.3 容量/件数只做数值同义候选

`Объем`、容量、体积、`Количество`、件数、数量等字段可以从 1688 标题和参数里提取明显数值，但不同类目字典的单位口径可能不同，不能直接写入 Payload。当前规则只做以下候选：

- 容量字段中，货源文本含 `500ml`、`500 мл`、`1L` 等容量表达时，只在当前属性字典中候选同数值的容量值。
- 件数/数量字段中，货源文本含 `10件`、`10pcs`、`10 шт` 等数量表达时，只在当前属性字典中候选同数值的件数值。
- 候选来源为 `capacity_synonym` / `count_synonym`，置信度 `0.68`，只输出到 `dictionaryCandidates`；非容量/件数字段不会触发。

### 1.4 尺码、包装数量、适用场景只做候选

`Размер`、包装数量、适用场景等字段很容易被包装尺重、营销词或类目词污染。当前规则只做以下窄范围候选：

- 尺码/尺寸字段中，货源文本含 `10cm`、`10 см`、`size M` 等表达时，只在当前属性字典中候选同尺码值；包装长宽高不能直接冒充商品尺码。
- 尺寸组合如 `10x20cm`、`10*20 см` 会优先匹配当前字典中的同组合值，例如 `10 x 20 см`；检测到组合表达时，不再用单个数字去匹配其他组合尺寸。
- 包装/套装数量字段中，货源文本含 `3-pack`、`一包3个`、`3件套` 等表达时，只在当前属性字典中候选同数量值。
- 适用场景字段中，货源文本含 travel/旅行、office/办公、bath/浴室、outdoor/户外、home/家用、car/车载、school/学校等明确场景词时，只在当前属性字典中候选对应场景值。
- `场景图`、素材描述、图片用途说明这类非 Ozon 适用场景字典字段不能触发 `scenario_synonym`；不能只因为字段名含“场景”就候选旅行/办公等值。
- 候选来源为 `size_synonym` / `package_count_synonym` / `scenario_synonym`，只输出到 `dictionaryCandidates`；候选必须人工确认、本地草稿写回并重新预检后，才能进入后续提交闸。

### 2. 品牌默认“无品牌”，不要冒充

大多数 1688 货源没有可用于 Ozon 的授权品牌。默认策略：

```text
品牌 = Нет бренда / 无品牌 对应字典值
```

不要使用：

- 1688 店铺名。
- 中文工厂名。
- Ozon 竞品品牌。
- 标题中的营销词。

### 3. 型号名称用于合并，不用于区分变体

同一父 SKU 下：

```text
型号名称 = 同一个父 SKU / 商品族名
颜色/尺码/容量 = 每个变体不同
```

如果每个变体的型号名称不同，可能无法合并；如果型号相同但可变特性也相同，会出现“无法与其他商品合并，至少更改一个可变特性”。

### 4. 变体属性必须“同组有差异”

`is_aspect=true` 的属性会参与 Ozon 合并逻辑。规则：

- 单品：可填默认值，但仍需合法。
- 多 SKU：至少一个可变属性在各 SKU 间不同。
- 颜色、尺码、容量、件数、重量等不能所有变体一样。
- 如果 1688 SKU 规格是中文，要先映射到 Ozon 字典值。
- 如果 aspect 是非字典文本属性，ERP 允许在 `waiting_human` 状态下由人工输入单个缺失值，写回本地 Payload 草稿并重新预检。
- 如果 aspect 是字典属性，必须从当前类目合法字典候选中人工选择；不能把文本值伪装成字典值。
- 如果 aspect 组合已经重复，不能用单格自动修复掩盖问题；必须人工检查整组 SKU 的颜色/尺码/容量组合。

示例：

```text
父 SKU：SKUlq00131
型号名称：SKUlq00131
白色 SKU：颜色=白色
黄色 SKU：颜色=黄色
蓝色 SKU：颜色=蓝色
```

### 5. 国家字段固定中国，但必须用字典值

原产国、制造国、生产国等字段应匹配 Ozon 字典中的“中国/Китай”。

不要直接填字符串 `"中国"`，除非该属性不是字典属性。

注意区分：

- `Страна-изготовитель` / 原产国 / 生产国 / 制造国：属于国家字段，1688 跨境货源默认中国，但字典 ID 必须来自当前 `description_category_id/type_id/attribute_id` 缓存。
- `Производитель` / 制造商：不是国家字段，不能自动填中国，也不能用店铺名/工厂名硬填；没有可信制造商资料时进入合规敏感人工确认。

### 6. 材质/成分字段要保守

材质可从 1688 参数中提取，但需要标准化：

| 1688 文本 | Ozon 方向 |
|---|---|
| 塑料、PP、ABS | 塑料/聚丙烯/ABS，按字典合法值 |
| 硅胶 | 硅胶 |
| 不锈钢、铁、合金 | 金属/不锈钢/合金 |
| 木质、竹 | 木材/竹 |
| 棉、涤纶、尼龙 | 纺织材料 |

如果材质影响安全、食品接触、儿童用品、化妆品等审核，应进入人工确认。

当前规则引擎已支持第一版中置信材质同义词候选：

- 货源文本含 `PP`、`ABS`、`塑料`、`聚丙烯` 时，可在当前类目材质字典中候选 `пластик` / `полипропилен` 等值。
- 货源文本含 `不锈钢`、`金属`、`铁`、`合金` 时，可候选当前字典中的金属类值。
- 货源文本含 `硅胶` 时，可候选当前字典中的 `силикон` 类值。

这些候选只输出到 `dictionaryCandidates`，来源为 `material_synonym`，不会直接写入 Payload。人工确认后仍需走本地草稿写回和重新预检。

### 7. 危险等级、保质期、储存条件不要乱填

这些字段容易影响审核和合规：

- 产品危险等级。
- 保质期。
- 储存条件。
- 成分。
- 制造商。
- 温度范围。

推荐策略：

```text
低风险通用品类 -> 建立类目默认规则
食品/化妆品/儿童/药品/化学/电池 -> 人工确认
无法识别 -> 阻塞，不自动提交
```

### 8. 标题会受属性反向影响

Ozon 标题经常由品牌、类型、模型、颜色、重要特征组成。属性填错会导致：

- 搜索曝光差。
- 筛选项错误。
- 商品卡合并失败。
- 标题模板生成异常。
- 审核拒绝。

所以自动标题生成必须和属性填写共用同一套“类型/品牌/模型/颜色”结果，不能各填各的。

## ERP 自动化优先级

### 第一优先级：可直接自动填

- 品牌：无品牌。
- 型号名称：父 SKU / 商品族名。
- 原产国： 中国。
- 商品尺寸/重量：1688 尺重解析。
- 颜色：1688 SKU 颜色词映射字典。

### 第二优先级：可半自动匹配

- 类型。
- 材质。
- 用途。
- 性别。
- 尺码。
- 容量。
- 件数。
- 适用对象。

这些字段要输出置信度：

```text
high：可自动进入 Payload 草稿
medium：只生成当前类目合法候选，人工确认后才可写本地 Payload 草稿
low：不自动填，进入人工规则池
```

### 第三优先级：默认阻塞或人工

- 产品危险等级。
- 保质期。
- 储存条件。
- 成分。
- 制造商。
- 温度范围。
- 涉及儿童、食品、化妆品、医疗、化学、电池、机动车配件的合规属性。

## 当前代码接入状态

已接入 `buildRequiredAttributeFillPlan()`，输入 `categoryMatch + attrsMeta + attributeValues + categoryCache + 1688 尺重/商品文本`，输出当前类目必填属性的可解释计划：

```js
{
  attributeId,
  name,
  strategy,
  confidence,
  action: "auto_fill" | "suggest_dictionary" | "manual_required" | "blocked_sensitive",
  source,
  value,
  dictionaryValueId,
  dictionaryCandidates,
  reasonZh,
  safetyTier: "autofill-safe" | "candidate-needs-human-confirmation" | "manual-required" | "blocked-never-guess",
  safetyLabelZh,
  requiresHumanConfirmation,
  blocksAutomation,
  safeNextStep
}
```

当前规则：

1. 高置信自动填：品牌无品牌、型号名称、原产国中国、尺重类字段；字典 ID 必须来自当前 `description_category_id:type_id:attribute_id` 缓存。
2. 中置信字典匹配：材质、类型、用途等只生成当前类目合法候选，动作是 `suggest_dictionary`，不自动写入。
3. 合规敏感：保质期、储存条件、成分、危险、温度、儿童/食品/化妆品/医疗/电池等进入 `blocked_sensitive`。
4. Payload 草稿和 preflight 总闸都会输出该计划，前端只读展示，不提交 Ozon。
5. 安全分层是只读元数据：`auto_fill` 对应 `autofill-safe`，`suggest_dictionary` 对应 `candidate-needs-human-confirmation`，普通人工项对应 `manual-required`，合规敏感项对应 `blocked-never-guess`。
6. `candidate-needs-human-confirmation` 只能在 workflow 等待人工且用户确认后走现有本地草稿修复路径；`blocked-never-guess` 不能被系统猜测、接受风险或自动写入。
7. `requiredAttributeFillSummary` 按四类安全分层汇总当前商品覆盖率；`requiredAttributeManualBacklog` 只读沉淀人工属性 backlog：
   - `rule_candidate`：普通人工字段，可继续沉淀类目规则。
   - `manual_required`：合规敏感/禁止猜测字段，必须人工核实。
   - `replace_source`：货源缺尺重、规格等关键证据，建议补证据或换货源。
8. `requiredAttributeRuleCandidateIndex` 从 `rule_candidate` 生成当前类目的只读规则沉淀候选，只展示候选属性、类目 key、候选状态和安全下一步；当前阶段不持久化、不自动生成规则、不写 Payload。

## 后续接入建议

1. 将 `requiredAttributeRuleCandidateIndex` 与多商品样本/类目历史连接，形成可审核的类目规则池草案，并继续保持测试先行。
2. 扩展 `variant_aspect_from_sku` 的可解释计划，显示每个 SKU 的 aspect 来源、字典候选和重复风险。
3. 为高频 `manual_rule_needed` / `manual-required` 属性补充可复用样本和人工规则说明。
4. 继续保持 `suggest_dictionary` 候选走人工确认写回本地草稿并重新预检。

## 参考资料

- Ozon Seller API 自动导入/更新商品：`https://dev.ozon.ru/start/294-Avtomaticheskii-import-i-obnovlenie-tovarov-v-Seller-API/`
- Ozon Seller API `type_id` 说明：`https://dev.ozon.ru/start/334-Ispolzovanie-polia-type-id-v-Seller-API/`
- Ozon Seller 教程：创建商品与填写特征：`https://seller-edu.ozon.ru/work-with-goods/zagruzka-tovarov/creating-goods/sozdanie-tovarov-v-lk`
- Ozon 标题规则：`https://seller-edu.ozon.ru/work-with-goods/trebovaniya-k-kartochkam-tovarov/nazvanie-tovara`
- Ozon 商品合并/模型字段：`https://seller-edu.ozon.ru/work-with-goods/zagruzka-tovarov/created-goods/kak-ob-edinit-tovary-v-odnu-kartochku`
- XWAY 商品合并经验：`https://xway.ru/blog/kak-obiedenit-tovary-na-ozon`
- MoySklad 商品卡经验：`https://www.moysklad.ru/poleznoe/marketplejsy/kartochka-tovara-na-ozon/`
