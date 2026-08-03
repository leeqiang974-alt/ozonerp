from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.listing_metadata_service import get_category_attributes, search_category_attribute_values
from app.models import Shop


class FakeClient:
    attribute_calls = 0
    value_calls = 0

    def __init__(self, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass

    def get_category_attributes(self, **kwargs):
        type(self).attribute_calls += 1
        return {"result": [{"id": 85, "name": "品牌", "is_required": True, "dictionary_id": 1, "type": "String"}]}

    def search_category_attribute_values(self, **kwargs):
        type(self).value_calls += 1
        if kwargs["value"] == "空结果":
            return {"result": [], "has_next": False}
        return {"result": [{"id": 970718, "value": "测试品牌", "info": "", "picture": ""}], "has_next": False}


def test_attribute_templates_and_dictionary_values_are_cached(monkeypatch) -> None:
    FakeClient.attribute_calls = 0
    FakeClient.value_calls = 0
    monkeypatch.setattr("app.listing_metadata_service.OzonSellerClient", FakeClient)
    monkeypatch.setattr("app.listing_metadata_service._credentials", lambda db, shop_id: ("id", "key"))
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="属性缓存店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)

        first_attributes = get_category_attributes(db, shop.id, "123", "456")
        second_attributes = get_category_attributes(db, shop.id, "123", "456")
        first_values = search_category_attribute_values(db, shop.id, "123", "456", "85", "测试")
        second_values = search_category_attribute_values(db, shop.id, "123", "456", "85", "测试")

        assert first_attributes == second_attributes == [{"id": "85", "name": "品牌", "required": True, "dictionary_id": "1", "type": "String"}]
        assert first_values == second_values == [{"id": "970718", "value": "测试品牌", "info": "", "picture": ""}]
        assert FakeClient.attribute_calls == 1
        assert FakeClient.value_calls == 1

        assert search_category_attribute_values(db, shop.id, "123", "456", "85", "空结果") == []
        assert search_category_attribute_values(db, shop.id, "123", "456", "85", "空结果") == []
        assert FakeClient.value_calls == 2
