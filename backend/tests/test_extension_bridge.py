from app.pipeline.extension_bridge import translate_capture


def test_sku_images_do_not_enter_public_source_gallery():
    translated = translate_capture({
        "offerId": "1688-demo",
        "title": "测试商品",
        "images": ["https://img.example/main.jpg"],
        "detailImages": ["https://img.example/detail.jpg"],
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
