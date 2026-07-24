import test from "node:test";
import assert from "node:assert/strict";
import { matchCategory } from "../src/ozonCategoryCache.js";

test("matchCategory routes enamel character pins to clothing brooches instead of generic decorations", () => {
  const flat = [
    { description_category_id: 17028993, type_id: 96386, path: "古董和收藏品 / 古玩和复古 / 古董室内装饰品，复古风格", name: "古董室内装饰品，复古风格" },
    { description_category_id: 17027906, type_id: 970959847, path: "住宅和花园 / 装饰和房间内饰 / 室内装饰品", name: "室内装饰品" },
    { description_category_id: 17027899, type_id: 93762, path: "小百货和配饰 / 服装首饰 / 徽章", name: "徽章" },
    { description_category_id: 17027899, type_id: 87458886, path: "小百货和配饰 / 服装首饰 / 胸针", name: "胸针" },
    { description_category_id: 200001634, type_id: 970808621, path: "文具 / 文具小件 / 文具别针", name: "文具别针" },
  ];
  const matches = matchCategory({
    title: "小精灵卡通胸针徽章服装背包饰品配饰别针跨境外贸热销合金胸章",
    attributes: [
      { name: "材质", value: "锌合金" },
      { name: "处理工艺", value: "烤漆" },
      { name: "功能", value: "纪念, 装饰, 固定" },
      { name: "商品类型", value: "饰品" },
    ],
  }, flat, 3);

  assert.equal(matches[0]?.type_id, 87458886);
  assert.equal(matches[0]?.autoSelectable, true);
  assert.match(matches[0]?.reasons.join("、"), /胸针/);
  assert.equal(matches[1]?.type_id, 93762);
});

test("matchCategory routes chenille wire craft products to craft materials", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "爱好和创作 / 手工艺品材料 / 手工铁丝", name: "手工铁丝" },
    { description_category_id: 2, type_id: 20, path: "儿童用品 / 玩具 / 玩具小汽车", name: "玩具小汽车" },
  ];
  const matches = matchCategory({ title: "Синельная проволока 扭扭棒 毛条 DIY花束材料包" }, flat, 1);

  assert.equal(matches[0]?.type_id, 10);
});

test("matchCategory routes commemorative coin products to collectible coins", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "文具 / 商业设备 / 硬币盒", name: "硬币盒" },
    { description_category_id: 2, type_id: 20, path: "古董和收藏品 / 收藏品 / 收藏钱币", name: "收藏钱币" },
  ];
  const matches = matchCategory({ title: "纪念币 100万卢布 сувенирная монета" }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});

test("matchCategory routes pet feeder products to pet tableware", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "儿童用品 / 儿童喂食产品 / 儿童喂食器具", name: "儿童喂食器具" },
    { description_category_id: 2, type_id: 20, path: "宠物用品 / 宠物餐具 / 宠物自动喂食器", name: "宠物自动喂食器" },
  ];
  const matches = matchCategory({ title: "Автокормушка для кошек собак поилка 猫碗 宠物自动饮水机 喂食器" }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});

test("matchCategory prefers pet feeder over pet bowl stand for automatic feeder titles", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "宠物用品 / 宠物餐具 / 宠物碗架", name: "宠物碗架" },
    { description_category_id: 2, type_id: 20, path: "宠物用品 / 宠物餐具 / 宠物自动喂食器", name: "宠物自动喂食器" },
    { description_category_id: 3, type_id: 30, path: "宠物用品 / 宠物餐具 / 宠物饮水器", name: "宠物饮水器" },
  ];
  const matches = matchCategory({ title: "Автокормушка и автопоилка для кошек собак 猫碗 宠物自动饮水机 喂食器" }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});

test("matchCategory prefers pet water dispenser for drinking fountain titles", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "宠物用品 / 宠物餐具 / 宠物自动喂食器", name: "宠物自动喂食器" },
    { description_category_id: 2, type_id: 20, path: "宠物用品 / 宠物餐具 / 宠物饮水器", name: "宠物饮水器" },
    { description_category_id: 3, type_id: 30, path: "住宅和花园 / 纪念品和礼品 / 纪念奖牌", name: "纪念奖牌" },
  ];
  const matches = matchCategory({
    title: "Автоматическая поилка фонтан для кошек и собак USB 静音宠物饮水机 流动饮水器",
    attributes: [{ name: "是否属于礼品", value: "是，商务礼品" }],
  }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});

test("matchCategory routes plush cat keychains to souvenirs instead of pet toys", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "宠物用品 / 宠物护理用品 / 宠物玩具", name: "宠物玩具" },
    { description_category_id: 2, type_id: 20, path: "家居 / 纪念品和礼品 / 纪念品", name: "纪念品" },
  ];
  const matches = matchCategory({
    title: "Брелок сувенирный котик мягкая игрушка антистресс плюшевый котенок 毛绒猫咪钥匙扣 挂件",
  }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});

test("matchCategory keeps cat keychains out of automotive gift sets", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "汽车用品 / 汽车配件 / 汽车爱好者礼品套装", name: "汽车爱好者礼品套装" },
    { description_category_id: 2, type_id: 20, path: "成人用品 / 情趣纪念品和游戏 / 情趣纪念品", name: "情趣纪念品" },
    { description_category_id: 3, type_id: 30, path: "住宅和花园 / 纪念品和礼品 / 装饰锁", name: "装饰锁" },
    { description_category_id: 4, type_id: 40, path: "小百货和配饰 / 配饰 / 袖珍钥匙扣", name: "袖珍钥匙扣" },
    { description_category_id: 5, type_id: 50, path: "住宅和花园 / 纪念品和礼品 / 纪念品", name: "纪念品" },
  ];
  const matches = matchCategory({
    title: "Брелок котик с колокольчиком подвеска на сумку ключи 猫咪铃铛钥匙扣 挂件 包包挂饰",
  }, flat, 1);

  assert.equal(matches[0]?.type_id, 50);
});

test("matchCategory prefers souvenir over crystal decor for cat keychains", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "住宅和花园 / 纪念品和礼品 / 水晶小饰品", name: "水晶小饰品" },
    { description_category_id: 2, type_id: 20, path: "住宅和花园 / 纪念品和礼品 / 纪念品", name: "纪念品" },
  ];
  const matches = matchCategory({
    title: "Брелок котёнок 3D подвеска на сумку ключи 猫咪钥匙扣 卡通立体公仔 挂件 饰品",
  }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});

test("matchCategory routes rose dome gifts away from gift wrapping paper", () => {
  const flat = [
    { description_category_id: 1, type_id: 10, path: "爱好和创作 / 手工艺品材料 / 礼品包装纸", name: "礼品包装纸" },
    { description_category_id: 2, type_id: 20, path: "家居 / 纪念品和礼品 / 纪念品", name: "纪念品" },
    { description_category_id: 3, type_id: 30, path: "家居 / 照明 / 夜灯", name: "夜灯" },
  ];
  const matches = matchCategory({
    title: "Роза в колбе с подсветкой красная подарок девушке 永生花 玻璃罩 LED玫瑰花 摆件 情人节礼品",
  }, flat, 1);

  assert.equal(matches[0]?.type_id, 20);
});
