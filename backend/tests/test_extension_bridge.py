from app.pipeline.extension_bridge import translate_capture


def test_sku_images_do_not_enter_public_source_gallery():
    translated = translate_capture({
        "offerId": "1688-demo",
        "title": "测试商品",
        "images": ["https://img.example/main.jpg"],
        "detailImages": ["https://img.example/detail.jpg"],
        "variantGroups": [{
            "styleId": "brown",
            "styleLabel": "棕色叶子",
            "skuIds": ["red", "blue"],
            "imageUrls": ["https://img.example/style-brown.jpg"],
        }],
        "richContent": {"content": []},
        "parseIssues": [],
        "skuVariants": [
            {"skuId": "red", "spec": "红色", "image": "https://img.example/red.jpg"},
            {"skuId": "blue", "spec": "蓝色", "image": "https://img.example/blue.jpg"},
        ],
    }, shop_id=1)

    assert [item["url"] for item in translated["media"]] == [
        "https://img.example/main.jpg",
        "https://img.example/detail.jpg",
    ]
    assert [item["image_url"] for item in translated["variants"]] == [
        "https://img.example/red.jpg",
        "https://img.example/blue.jpg",
    ]
    assert translated["variant_groups"][0]["imageUrls"] == ["https://img.example/style-brown.jpg"]
    assert translated["rich_content"] == {"content": []}


def test_ozon_variant_rub_price_never_becomes_cny_cost():
    translated = translate_capture({
        "productId": "3270409949",
        "title": "Мыльница",
        "skuVariants": [
            {"skuId": "sku-new", "spec": "Цвет: белый", "priceRub": 108.19},
            {"skuId": "sku-legacy", "spec": "Цвет: серый", "price": 120.50},
        ],
    }, shop_id=1, source_platform="ozon_public")

    assert [item["price_cny"] for item in translated["variants"]] == [None, None]
    assert [item["price_rub"] for item in translated["variants"]] == [108.19, 120.50]


def test_ozon_public_banner_and_none_values_are_rejected():
    translated = translate_capture({
        "productId": "3270409949",
        "title": "Мыльница",
        "sourceShopName": None,
        "images": [
            "https://cdn1.ozonusercontent.com/s3/marketing-api//banners/bad.jpg",
            "https://cdn1.ozonusercontent.com/s3/multimedia-a/good.jpg",
        ],
        "image": "https://cdn1.ozonusercontent.com/s3/marketing-api//banners/bad.jpg",
        "skuVariants": [],
    }, shop_id=1, source_platform="ozon_public")

    assert translated["source_shop_name"] is None
    assert [item["url"] for item in translated["media"]] == ["https://cdn1.ozonusercontent.com/s3/multimedia-a/good.jpg"]
    assert translated["main_image_url"] == "https://cdn1.ozonusercontent.com/s3/multimedia-a/good.jpg"
