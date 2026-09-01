import pytest

from app.integrations.yunniudun_supplement import (
    YunNewtonSupplementError,
    build_link_collection_message,
    normalize_link_collection_result,
)


SOURCE_URL = "https://detail.1688.com/offer/822581032243.html?from=erp"


def test_build_message_is_read_only_and_requires_media_separation():
    message = build_link_collection_message(SOURCE_URL)
    assert "询盘" in message and "下单" in message
    assert "SKU 专属图" in message
    assert "822581032243" in message


def test_normalize_result_keeps_sku_images_out_of_public_galleries():
    raw = {
        "content": "```json\n" + __import__("json").dumps({
            "offerId": "822581032243",
            "title": "八角帽",
            "images": ["https://img.example/main.jpg"],
            "detailImages": ["https://img.example/detail.jpg"],
            "skuVariants": [
                {"skuId": "black-l", "spec": "黑色 / L", "price": 19.5, "stock": 879, "image": "https://img.example/black.jpg"},
                {"skuId": "coffee-xl", "spec": "咖啡 / XL", "price": 19.5, "stock": 841, "image": "https://img.example/coffee.jpg"},
            ],
            "packageInfo": {"weightG": 119, "lengthMm": 230, "widthMm": 120, "heightMm": 120},
        }, ensure_ascii=False) + "\n```",
    }
    capture = normalize_link_collection_result(raw, SOURCE_URL)
    assert capture["images"] == ["https://img.example/main.jpg"]
    assert capture["detailImages"] == ["https://img.example/detail.jpg"]
    assert [row["image"] for row in capture["skuVariants"]] == [
        "https://img.example/black.jpg", "https://img.example/coffee.jpg",
    ]


def test_normalize_result_rejects_mismatched_offer():
    with pytest.raises(YunNewtonSupplementError, match="Offer ID"):
        normalize_link_collection_result({"offerId": "999", "title": "错误"}, SOURCE_URL)
