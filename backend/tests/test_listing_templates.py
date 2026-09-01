from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.listing_template_service import apply_listing_template, create_listing_template
from app.models import Shop


def test_listing_template_persists_category_and_fixed_attribute_values() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop = Shop(name="模板店铺", currency="CNY")
        db.add(shop); db.commit(); db.refresh(shop)

        template = create_listing_template(
            db, shop.id, "硅胶模具通用模板", "17027904", "970575517",
            [{"attribute_id": "85", "name": "品牌", "value_id": "126745801", "value_text": "Нет бренда"}],
            description="固定的俄文产品说明",
        )
        applied = apply_listing_template(template)

        assert applied["category_id"] == "17027904"
        assert applied["type_id"] == "970575517"
        assert applied["description"] == "固定的俄文产品说明"
        assert applied["attributes"] == [{"attribute_id": "85", "name": "品牌", "value_id": "126745801", "value_text": "Нет бренда"}]
