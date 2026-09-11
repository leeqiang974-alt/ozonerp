## 2026-09-10 | v9 | 修复 Ozon 卡片缺陷：富内容空文本 + 颜色属性中文（XY000006）| 已实测
**问题 1**：Ozon 后台报"JSON内容 - 更正了属性值，Rich-content JSON 不符合模板"（XY000006-черный）。
**根因**：build_import_payload 用 pipeline.generated_title_ru/description_ru 构建 11254，而 pipeline（id=2070）这两个字段为空 → 生成空文本块富内容 JSON → Ozon 拒绝。
**修复**：publish_service.build_import_payload 增加兜底——pipeline 生成字段为空时回退 draft.title/description 再构建 11254。
**问题 2**：属性更新报 BR_chinese_hieroglyphs_in_attribute（attribute 10097 颜色名称含中文）。
**根因**：1688 采集的颜色"黑色"未翻译，本地 Ozon 字典缓存 10096 也是中文；提交时 10097=name_ru="黑色" → Ozon 拒绝非俄文颜色。
**修复**：publish_service 提交 10096/10097 前统一用 _COLOR_RU 中文→俄文翻译（字典 value_id 不变）；saved_vv 分支重建颜色时同样翻译。
**验证**：submit_fixes(5,1657) 带俄文颜色 overrides（Черный）重跑 → attributes task 5596167700 imported 且 errors=[]；图片 15/15 imported；视频已挂。
**说明**：存量 listing_attribute_values 10096 中文颜色约 1650 行（黑色 1617 等），待批量翻译为俄文（未执行，需用户确认）。
## 2026-09-10 | v8 | 修复"JSON富内容不符合模板"（11254 富内容模板统一为纯文本）| 已实测
**问题**：Ozon 后台报"JSON富内容 - 更正了属性值，因为：Rich-content JSON 不符合模板"。
**根因**：`ai_service.generate_rich_content`（draft 保存/前端生成用）生成含 `raShowcase` 图片块的旧模板，图片为外部 URL（OSS/alicdn）→ Ozon 富内容模板校验器拒绝（"Rich-контент JSON не соответствует шаблону"）。提交路径（build_import_payload / fix_submit_service）早已统一为纯文本模板，但保存时落库的 11254 仍是旧格式。
**改动**：`backend/app/ai_service.py` generate_rich_content 移除 raShowcase 图片块，仅保留 raTextBlock（欢迎语 + 描述）+ version:0.3，与已验证模板一致（同 rich_content.build_rich_content）。
**验证**：py_compile 通过；实测生成输出 widgets=[raTextBlock, raTextBlock]、version=0.3、不含任何图片 URL。
**说明**：存量草稿 11254 落库值不迁移（提交时 build_import_payload 无条件重建为纯文本，无影响）；已提交商品的该属性由 Ozon 自动更正，不影响卡片。
# Ozon ERP — 迭代日志（CHANGELOG）

> 规则：每次插件/后端修改必须在此追加一条记录。格式：`日期 | 版本 | 改动摘要 | 验证方式`。
> 版本号规则：`vYYYYMMDD.n`（当天第 n 次迭代）。

---

## 2026-09-09 v1 — 胸针商品卡修复 + 「提交修正」逻辑落地

**背景**：XY000005 系列胸针（draft id=1589，shop 5）两张商品卡被 Ozon 退审：绿 SKU 报"链接无效 ×4"、黄/绿报"Rich-контент JSON 不符合模板"、颜色显示棕/灰、两卡未合并。

**改动**：
1. `backend/app/pipeline/fix_submit_service.py`（新建）：`submit_fixes()` 全链路——重建每 SKU 属性（颜色支持 UI override、9048 型号名统一）、每 SKU 独立图片导入（`import_product_pictures`，SKU 专属图排首位 is_primary）、Yandex 直链视频挂载（`attach_videos_v2`）。**只改属性/图片/视频，不动价格/库存/标题**。
2. `backend/app/pipeline/rich_content.py`：去掉富内容 JSON 的 `"version": 0.3` 字段（Ozon 模板不接受）→ 修复后提交修正**不再携带 11254 富内容**（Ozon 模板校验器对外部图 URL / 纯文本结构仍会擦除，擦了也只是 warning 不拒审；商品图库走独立接口不受影响）。
3. `backend/app/integrations/ozon_seller.py`：新增 `attach_videos_v2`（按类目解析真实视频属性 21841/21837/22273）、`get_product_ids_by_offer`（/v3/product/info/list 查不到时 fallback /v3/product/list 分页）、`import_product_pictures`。
4. `backend/app/main.py`：新增 `POST /api/v1/shops/{shop_id}/listing-drafts/{draft_id}/submit-fixes`（body 支持 `color_overrides` 按 offer_id 传黄/绿等颜色字典值）。
5. `frontend/listing-editor.html` + `listing-editor.js`：已提交卡片后显示「提交修正」按钮，调 `submitDraftFixes()`。

**修复结果（Ozon 端实测）**：
- 颜色：2557=желтый（61578）、2558=зеленый（61583）✓
- 合并键 9048 统一 XY000005，商品卡已合并（同 model，count=2）✓
- 两 SKU 任务反馈 errors=0 ✓；图片 imported、用户改的绿 SKU 首图 is_primary=true ✓
- 视频保持 Yandex 直链（disk.yandex.com/i/J5Bf7ag_PdWFDQ）✓

**操作规范**：改图/改颜色后必须走「提交修正」，**不要**重新走「提交新品」——完整重提会用 1688 占位名重算颜色（fallback 成棕/灰）并触发完整重审，覆盖已修正状态。

**验证**：py_compile 通过；后端重启 health ok；submit-fixes 接口 HTTP 200；拉 `/v1/product/import/info` 确认 errors=0；拉 `/v4/product/info/attributes` 确认颜色/9048 值。

---

## 2026-09-08 v3 — AI 生图链路最终定型（含容灾）

- 生效链路：**前置分析 agnes-2.5-flash（包月）→ 生成 gpt-image-2**（可并发 4），模板 `d:\Desktop\api\01 主图.txt`（用户验收）。
- 容灾顺序：agnes → 火山（codingplan，仅文本）→ deepseek（仅文本）；任一不通不阻塞任务。
- 8 图轮播视频用 ffmpeg 生成（非 AI，`slideshow_8img_16s_1080p_ffmpeg.mp4`，用户验收"非常棒"）。
- 已知边界：agnes-image 生成无俄文文案、双色产品会混色（用户已确认退回 gpt-image-2）。

## 2026-09-08 v2 — 图片处理/视频下载超时保护

- 视频下载加超时保护；PIL 打开/尺寸检查加超时保护（防采集带视频/异常图产品卡死批量）。

## 2026-09-08 v1 — Yandex Disk 视频托管 + Ozon 视频挂载

- `backend/app/yandex_disk_service.py`：直连优先 + 失败自动 fallback 代理，实测上传发布成功。
- `backend/app/integrations/ozon_seller.py`：`attach_videos_v2`（Ozon 只认 RuTube/VK/Яндекс Диск 直链，media.woxq.cn 代理链判"链接无效"）。
- 富内容 `rich_content.py` 去除 version 字段（此迭代发现，9-09 已彻底改走不提交富内容）。

## 2026-09-07 v1 — 批量徽章任务运行机制

- batch_id=1 约 3000+ 商品，每天 8:05 定时自动跑，4 店并发（每店每天 100 上传名额）。
- waiting_quota 商品次日拉回 queued；import_failed 153 个（商品卡被 Ozon 拒收）单独修标题/图片重传；类目超限店（xymallc）配额自动分流到其他店。
- 前端状态文案中文化。

---

## 2026-09-09 v3 【富内容 11254 缺陷修复】（已实测闭环）

- **根因**：Ozon 富内容模板校验器只接受「纯文本 raTextBlock + 顶层 version 字段」；下午迭代误删 version + 提交图库结构（外部图 URL）导致今天报「Rich-content JSON 不符合模板」。空 JSON `{}` 同样被拒。
- **有效结构（已实测 errors=0）**：`{"content":[{"widgetName":"raTextBlock","type":"text","blocks":[{"imgLink":"","img":{...空},"paragraphs":[{"content":"<俄文>","size":"size3","color":"color1","align":"align1"}]}]}],"version":0.3}`（参照同店已通过商品 XY000001）。
- **改动**：`backend/app/pipeline/rich_content.py` 恢复 `version:0.3`，改为纯文本（标题+描述两块，不嵌外部图）；`backend/app/pipeline/fix_submit_service.py` 11254 从「故意不提交」改为「提交有效富内容」。
- **验证**：XY000005 两 SKU 提交通道测试 v1（无 version）报 `erased_attribute_value`、v2（带 version）`errors=0`；后端已重启，`/health ok`。

## 2026-09-09 v4 【全局缓存并发修复】UniqueViolation

- **根因**：4 店并发批量同步同一 (category_id,type_id) 属性时，`listing_cache_service`（先查后插）与 `listing_metadata_service`（先删后插）存在竞态，报 `uq_global_attribute_cache` UniqueViolation（批量 failed 2 个）。
- **改动**：两服务对同类目缓存写入加 PostgreSQL 事务级 advisory lock（`pg_advisory_xact_lock`，key=crc32(category:type)），提交/回滚自动释放；编译通过，后端已重启。

## 2026-09-09 v5 【import_failed 补库存重排】

- 当日自动化任务核查：批量 batch_id=1 徽章共 3076，状态 queued 1665→1822 / imported 1098→1031 / waiting_quota 141 / skipped / needs_review / failed 2（UniqueViolation，v4 已修）。
- **import_failed 199 个处置**：可自动修复 160 个（标题 95 / 描述 49 / 品牌 hashtag 6 / 外部链接等）→ 质量预检清洗草稿 + bulk item 重置 queued attempts=0，批量调度自动重新提交并补库存；不可修/违规 19 个（重复商品、无法合并、属性值错误、尺寸重量、撒旦教、脏话等）→ 归档（moderation_status=archived / skipped）；额度满 20 个保持等待（明日 8:05 自动）。
- 快照：`C:\OzonERP\tmp_import_failed_snapshot.csv`（199 行，可回滚）。
- 备注：批量实时运行中，新产生的 import_failed（约 39 个）由批量机制 3 次重试后自动转人工/归档。

---

## 2026-09-10 v1 【产品编辑页属性下拉：搜索栏合并】

- **需求**：所有属性下拉（多选字典）去掉弹层内独立搜索栏，搜索能力并入上方输入框（点击选项可多选的第一栏），界面更简洁，其余功能不变。
- **改动**（`frontend/listing-editor.js`，仅多选 isColl 分支 + renderOpts/loadOpts）：
  - 移除下拉弹层内的 `.le-ms-search` 搜索框渲染与过滤绑定；
  - 上方输入框直接承担搜索：输入即本地过滤已加载选项 + 300ms 防抖调 API 搜索（带 `msSearchSeq` 过期响应丢弃守卫）；
  - Backspace/Delete：输入框无搜索词（显示已选项文本）时删除最后一个已选项；有搜索词时正常编辑字符；
  - 失焦 150ms 后恢复已选项显示文本并关闭下拉；点击选项后保持输入框焦点、显示全量选项；
  - `refreshDisplay` 加 `_restoring` 保护，防止设值触发 input 事件递归。
- **验证**：`node --check` 通过；文件 SHA256 本地/远端一致；单选项（单选字典）搜索逻辑未改动。
- **备注**：静态文件改动，刷新浏览器页面即生效（无需重启后端）；变体设置颜色多选（le-color-ms）为独立组件，未在本次范围内。

---

## 2026-09-10 v2 【编辑页：生成视频按钮 + 原产国自动选中中国】

- **生成视频按钮**（视频⑦区块）：新增"生成视频"按钮，点击后用产品图前 8 张调用既有 `POST /api/v1/shops/{shop_id}/videos/slideshow`（本地 ffmpeg 轮播，非 AI、零成本）→ 自动上传 Yandex Disk → 返回直链回填"视频链接"输入框；Yandex 上传失败时回退本地预览链接并提示。Ozon 只接受 RuTube/VK/Яндекс Диск 来源，Yandex 直链可直接挂载。
- **原产国写死中国**：根因 = `autoFillDefaults` 对字典属性统一 `continue`，原产国（Страна производства，dictionary 单选）的"中国"填充从未执行，只残留无 value_id 的显示文本。修复：字典属性分支内对"原产国/страна"自动调 Ozon 词典接口（query=中国）解析真实 value_id 并选中（已有有效选择时不覆盖），input 同步 data-selected-value-id 并清除 manual 标记。
- **改动文件**：`frontend/listing-editor.html`（按钮）、`frontend/listing-editor.js`（setupVideoHandlers + autoFillDefaults + 新增 autoSelectCountryChina）。
- **验证**：`node --check` 通过；两文件 SHA256 本地/远端一致；后端 slideshow 接口复用，无后端改动。
- **备注**：静态文件，浏览器强刷（Ctrl+F5）生效；无需重启后端。

---

## 2026-09-10 v3 【AI 生图颜色保真修复（严重）】

- **症状**：压泥器（黑色防滑手柄+不锈钢）生成 8 张图全部变成黄色手柄+金色金属，产品颜色完全改变。
- **根因**（visual_image_service.py）：
  1. `_ref_color_hint` 分析参考图主色时，不锈钢高光/反光的暖色调被误判为 `warm amber / golden yellow`；
  2. color_lock 据此强制"整产品必须统一为单一金色/黄色"，gpt-image-2 被要求把每个细节都改成该色系 → 黑色手柄+银色金属被系统性改成金/黄；
  3. `_strip_color_words` 把 prompt 中"黑色"等确定性颜色锚点也剥除，模型失去颜色依据（该机制原为防胸针类"绿/黄多可选色"混色设计）。
- **修复**（三处）：
  1. `_ref_color_hint`：增加彩色像素占比门槛（<3% 不输出强制色），不锈钢/黑白/金属反光主导的产品不再被误判；
  2. color_lock 措辞：从"统一单色"改为"各部件（手柄/金属/宝石/织物）保持参考图各自原色，禁止改色/统一/混色/加色，文字颜色词仅作锚点"；
  3. `_strip_color_words`：中性色（黑/白/银/灰）保留为锚点，只剥多可选彩色词（绿/黄/红/蓝/粉等）。
- **验证**：后端已重启（health ok）；job 17（压泥器）8 槽全部重跑成功，hero/lifestyle 抽查均为黑色手柄+不锈钢，与参考图一致。
- **改动文件**：`backend/app/visual_image_service.py`（后端，已重启生效）。
- **备注**：已生成过的其他产品如需修正，前端"重做此图"即可（新逻辑生效）。

---

## 2026-09-10 v4 【前端：点击图片放大预览（AI 款式套图面板 + 款式图片设置弹窗）】

- **症状**：①AI 款式套图面板点任何图片都刷新整个面板（原逻辑：点图=切换选中+整面板重渲染）；②款式图片设置弹窗点图片无放大（pointerdown/mousedown preventDefault 抑制了 click，且卡片未绑放大）。
- **修复**（frontend/listing-editor.js）：
  1. AI 款式套图：卡片点击图片 → 放大预览（复用 lightbox，点外围/×关闭）；选用改由卡片左上角勾选框控制（勾选=应用到当前款式，不影响公共图库）；键盘 Enter/空格同样放大。
  2. 款式图片设置弹窗：img 加 draggable=false；pointerdown/mousedown 去掉 preventDefault（click 正常触发）；卡片点击图片 → zoomInlineImage 放大（点外围关闭）；拖拽重排（>6px）逻辑保留，拖拽后 render() 重建 DOM 不会误弹放大。
  3. 新增通用 window.zoomInlineImage(url)。
- **验证**：node --check 通过；已写回 \\192.168.0.147\OzonERP\frontend\listing-editor.js（SHA256 一致）。静态文件强刷（Ctrl+F5）生效。
- **备注**：`设为首图` 后外部变体表 SKU 首图列会同步刷新（onImagesChanged→renderVariantTable）；若用户指"外部"为第⑥步公共图库区，那是所有款式共享、设计上不被单款覆盖，待确认是否要联动。

---

## 2026-09-10 v5 【生成视频自动保存 + 找回已丢失的视频链接】

- **症状**：产品编辑页点"生成视频"后，刷新页面视频链接消失（生成只回填输入框、未写草稿 video_url）。
- **修复**（frontend/listing-editor.js）：生成视频成功且拿到直链后，自动调用 saveDraft() 持久化；保存成功提示"已保存到草稿"，失败（缺 Offer ID/标题）提示补全后保存。
- **找回**：今天 10:01 生成的 slideshow_5_20260910_100105.mp4（8.3MB，shop5）已重新上传 Yandex Disk 并发布，直链已写入 listing_drafts id=1657（压泥器）video_url（首传超时系公网直连慢，加大超时后成功，耗时 65s）。
- **验证**：node --check 通过，前端已写回远端（SHA256 一致）；draft 1657 video_url 已更新，刷新页面可见。CHANGELOG 已记。
- **备注**：Yandex 上传依赖代理/网络，超时上限已放宽（脚本 240s）。

---

## 2026-09-10 v6 【设为首图/当前首图不再刷新界面（轻量更新）】

- **症状**：款式图片设置弹窗里点击"当前首图"或"设为首图"，弹窗重建 + 整页图片区/变体表重渲染（用户感知为"刷新图片"）；其中"当前首图"点击本无意义也会刷新。
- **修复**（frontend/listing-editor.js data-gallery-primary 绑定）：
  1) "当前首图"（已是第一位）→ 静默 return，零刷新；
  2) "设为首图" → 更新顺序后不再调用 onImagesChanged()/render()，改为轻量更新：弹窗内已选区卡片 DOM 重排（序号/按钮文字/拖拽索引同步），外部变体表该款 3 个缩略图 src 直接替换。
- **验证**（浏览器实测，draft 1657）：点"当前首图"卡片节点保持 connected（无重建）；点第 2 张"设为首图"弹窗节点同一（modalStillSame）、卡片重排为"1·首图·款式图/当前首图"、外部首图缩略图同步更新。node --check 通过，已写回远端（SHA256 一致）。
- **备注**：AI 款式套图面板点图放大（v4）与款式图库点图放大预览（v4）已实测有效。

---

## 模板（下一条迭代用）

```
## YYYY-MM-DD vN — 标题

**改动**：...
**验证**：...
**备注**：...
```

## 2026-09-10 v7 — 批量导入采集（粘贴 1688 offer 表 → 候选队列 → 插件自动采集）

**背景**：用户手上常有一批 1688 商品清单（AI 筛选或 CSV），需要批量入队采集进采集箱，而不是逐个复制粘贴到插件。

**改动**：
1. `backend/app/automation_routes.py`：新增 `POST /api/v1/automation/import-offers`——接收 `{shop_id, items:[{offer_id,title,source_url,price_min}]}`；自动归一化 offer_id（纯数字或从 `/offer/(\d+)` 链接提取）、过滤无效行、查重（已在 source_products / automation_candidates 的跳过）；原生 SQL 建 task(status=paused 不干扰定时调度)+run(status=active,current_stage=queued_detail)+candidates；**复用现有爬虫消费链路**（插件 worker 自动逐个采集）。
2. `frontend/index.html`：采集箱 toolbar 新增「批量导入采集」按钮 + 粘贴弹窗（目标 Ozon 店铺下拉、textarea 支持三种格式：纯 offer_id / 1688 链接 / offer_id,名称,价格，可直接粘 CSV）。
3. `frontend/app.js`：`parseOfferLines()` 行解析（自动忽略表头/重复/脏行）+ `initImportOffers()` 交互（实时预览识别数量、入队后刷新采集箱）。

**验证方式**：
- 后端 `python -m py_compile` 通过；前端 `node --check` 通过。
- 浏览器实测：按钮显示 → 弹窗店铺下拉填充 → 粘贴混合格式（3 有效+1 重复+1 脏行）→ 预览"识别 3 条有效商品"、入队按钮启用 → 提交（后端未重启返回 404，toast 优雅提示、按钮恢复）。
- **后端需重启 uvicorn 后接口生效**（用户定：晚上闲时重启）。

**v7 增强（同日）—— 解析器升级为"整表智能识别"**：
- `parseOfferLines()` 重写：不再要求固定格式，直接粘贴任意表头/列序的表格（Excel/CSV 复制）——自动投票识别链接列（含 1688 链接）、ID 列（≥6 位纯数字）、名称列、价格列；表头语义加权（"商品名称/标题"强词 >"名称"弱词，"商品链接/url/offer" 等），自动跳过表头行、重复行、脏行；链接和 ID 都能识别，无链接时兜底取任意长数字。
- `frontend/index.html`：app.js 版本号 `?v=131 → ?v=132`（强制刷新资源）。
- 实测四场景全过：①完整 CSV（链接列在最后）②只有链接列 ③只有 ID 列 ④乱序表头（链接第一、供应商第二、商品名称第三、价格第四）——id/title/price/url 全部正确。

## 2026-09-10 后端重启（v8/v9 生效确认）
- 原因：今早重复启动导致 2 个 uvicorn 并存（8000 由重复进程持有），且 v8/v9 改动一直未加载到运行进程（“昨天改过今天又犯”的根因）。
- 动作：杀掉全部旧 uvicorn（PID 492/8756），单实例重启（新 PID 6992），/health ok + database ok。
- 生效验证（运行代码实测）：
  1. v8 纯文本富内容：generate_rich_content 仅输出 raTextBlock（welcome + 描述），无 raShowcase/外链图，version 0.3。
  2. v9 颜色俄译：build_import_payload 提交 10096/10097 前 _COLOR_RU 翻译（黑色→Черный 等 15 色），映射已生效。
  3. v9 富内容兜底：pipeline 生成字段为空时回退 draft.title/description 再构建。
- 批量徽章 batch_id=1：9:50 卡死 2 个 processing（无 ozon_task_id）已按 _recover_stale 逻辑复位为 queued；批次 running→ready_to_continue；**未触发继续**（用户要求先不恢复）。


## 2026-09-10 批量导入弹窗：支持上传表格文件 / 粘贴文件路径（v10）
- 需求：采集箱「批量导入 1688 采集」不再只支持 textarea 文字粘贴，支持上传 CSV/Excel/TXT 或直接粘贴本机/共享路径。
- 后端（automation_routes.py）：
  - _parse_offer_lines_py：Python 版整表智能识别（与前端 parseOfferLines 对齐，任意表头/列序，自动投票链接/ID/名称/价格列）。
  - _read_offer_file：读 CSV/TXT（utf-8-sig/gb18030/cp1252 自动探测）与 XLSX（openpyxl）。
  - 新接口 POST /api/v1/automation/import-offers/parse-file（multipart 上传）与 /import-offers/read-path（路径读取）；均只解析不入队。
  - 依赖：venv 安装 python-multipart（UploadFile 需要）。
- 前端：index.html 弹窗新增「上传表格文件」（.csv/.txt/.xls/.xlsx）与「读取路径」输入；app.js 新增 fillImportOffers（解析结果回填 textarea 并触发预览）；app.js?v=132→v133 防缓存。
- 验证：py_compile 通过；read-path / parse-file 端到端实测（表头+链接行+纯 id 混合 CSV 识别 3 条，字段正确）；5500 静态输出确认新文件已生效。
- 说明：批量徽章 batch_id=1 仍为 ready_to_continue（用户未批准恢复）。


## 2026-09-10 SKU 图翻译：配置象寄 API 密钥（v11）
- 现象：前端「SKU 图翻译」报"象寄 API 密钥未配置"（截图 OCR 显示为"象言"）。
- 根因：/api/v1/image/translate（阿里云国际 GetImageTranslate）需要 XIANGJI_PRIVATE_KEY + XIANGJI_IMG_TRANS_KEY，.env 从未配置。
- 动作：在 C:\OzonERP\.env 追加两个 key（用户提供：私人密钥 + 图片翻译标识码），重启后端（PID 6888，health ok）。
- 验证：① 无效 URL 请求不再报缺密钥（走 URL 校验）；② 真实公网图翻译成功（返回 translated_url + request_id，Code 200）。

## 2026-09-10 AI 款式套图交互修复 + 变体 SKU 图翻译入口（v12）
- 需求：① 生图任务已完成但「应用到该款式 SKU」按钮长期灰色；② 点款式组「AI 作图」后上方 AI 图库图片瞬间消失；③ 无变体类目（如刮雪铲）没有 SKU 图翻译入口。
- 根因：① 前端轮询窗口仅 5 分钟，而本次生图实际耗时 19 分钟，轮询提前退出导致前端停在 generating（applyBtn 仅在 ready/failed/interrupted/applied 可用）；② 点「AI 作图」触发 generateAndApplyStyleHero，立即把 AI 面板切到该款式新任务并渲染空槽，旧图被顶掉；③ 「翻译」按钮只在 renderColorSamples（颜色样本区）渲染，而无变体类目 variantDimensions 无颜色属性 → 颜色样本隐藏 → 翻译入口消失。
- 前端（listing-editor.js）：
  - generateAiImages：轮询窗口 5min→30min（任务可跑 20+ 分钟）。
  - generateAiImages：单槽生成（款式首图/单张重做）提交后保留旧视图，图片回包后再刷新，不再瞬间被空槽顶掉。
  - renderVariantTable：款式图列「AI 作图」旁新增「翻译」按钮（translateVariantImage），所有类目（含无变体）均可用。
- 验证：node --check 通过；源码 diff 复核三处修改均在预期位置。
- 生效：硬刷新（Ctrl+Shift+R）加载新 JS。
## 2026-09-11 AI 生图应用后变体表格缩略图不显示（v13）
- 现象：AI 套图生成正常（面板 8 图可见），点「应用到所有 SKU」后变体表格「款式图/颜色样本/产品图」列无缩略图，界面像挂了。
- 根因：后端 PUBLIC_PREFIX 默认/被 .env 配置为 http://127.0.0.1:5500/generated/ai-images → 生成的 AI 图 URL 全部是 127.0.0.1。前端虽有 displayImageUrl() 把 127.0.0.1:5500 重写为 location.origin，但变体表格 4 处 <img>（groupCells 款式图/颜色样本/产品图 + renderColorSamples 颜色样本容器）直接用了原始 groupImg/image，未走重写 → 用户浏览器尝试加载本机 127.0.0.1:5500 失败 → onerror 透明 → 看起来无图/挂掉。AI 面板（renderAiImageJob）走了重写所以正常。
- 修复（listing-editor.js）：4 处 <img src> 改为 displayImageUrl()（groupImg 3 处 + image 1 处）。
- 备注：提交 Ozon 不受影响（后端 _publicize_listing_images 检测 127.0.0.1 本地 URL 会先上传 OSS 再提交）；.env 的 GENERATED_IMAGE_PUBLIC_BASE 仍为 127.0.0.1，新图 URL 继续靠前端重写显示，如需根治可改为 http://192.168.0.147:5500/generated/ai-images（需重启后端，未执行）。
- 验证：node --check 通过；替换计数 groupImg=3 image=1；前端硬刷新后变体表格缩略图应正常显示。
## v14 (2026-09-11)
- 修复「应用到该款式 SKU」按钮误写所有 SKU：handler 原传 applyAiImages(false, true)（applyAll），现改为 applyAiImages(false, false)——只把当前款式组生成图写入该款式的尺寸 SKU，不再污染其他款式/公共图库。
- 背景：雪铲草稿（draft 1699）可伸缩 SKU 应用 job20 hero 图时暴露此问题；应用已单独执行并验证（可伸缩行=visual-20-hero，不可伸缩行=原图不变）。

## v15 (2026-09-11)
- 修复「应用到该款式 SKU」仍可能应用到所有 SKU 的漏洞：applyAiImages 原代码在款式组匹配失败时 fallback 到全部 variants（targetGroup?.indexes || 全部），现改为匹配失败返回 [] 并 toast 提示"未匹配到当前款式组"，禁止静默污染其他 SKU。
- 版本戳 bump 至 v=105。

## v16 (2026-09-11)
- 简化 SKU 专属生图使用逻辑：变体表格行「AI 作图」生成 hero 后，不再自动应用/自动设为首图，改为自动加入该款式 SKU 的图库（image_urls），主图由用户点击产品图列打开图库后手动「设为首图」。
- 版本戳 bump 至 v=106。

## v17 (2026-09-11)
- 所有编辑页面的图片（变体表格款式图/颜色样本、款式图片设置弹窗两侧缩略图等）点击即可放大预览，点击放大层或 × 关闭；复用现有 .le-ai-image-lightbox 组件。
- 保留全部既有交互：产品图列点击打开图库、AI 候选图点击放大/选中、图库弹窗内设为首图/加入此款式/删除/拖拽排序均不动。
- 版本戳 bump 至 v=107。
