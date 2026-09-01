from app.marketing_service import is_protected_promotion, product_ids_from_action_page


def test_only_cpc_and_cpo_promotions_are_protected() -> None:
    assert is_protected_promotion("CPC") is True
    assert is_protected_promotion("CPO") is True
    assert is_protected_promotion("ELASTIC_BOOSTING") is False
    assert is_protected_promotion("STOCK_DISCOUNT") is False


def test_action_product_ids_use_ozon_product_id() -> None:
    page = {"result": {"products": [{"id": 101}, {"product_id": 202}, {"id": None}]}}
    assert product_ids_from_action_page(page) == [101, 202]
