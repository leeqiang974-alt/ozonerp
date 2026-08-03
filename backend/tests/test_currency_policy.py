from app.schemas import ShopCreate, ShopUpdate
from pydantic import ValidationError
import pytest


def test_shop_defaults_to_cny() -> None:
    assert ShopCreate(name="中文店铺").currency == "CNY"


@pytest.mark.parametrize("payload", [{"name": "店铺", "currency": "RUB"}, {"currency": "USD"}])
def test_only_cny_is_allowed(payload: dict[str, str]) -> None:
    schema = ShopUpdate if "name" not in payload else ShopCreate
    with pytest.raises(ValidationError):
        schema(**payload)
