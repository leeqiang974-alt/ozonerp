from app.offer_id_service import normalize_offer_id, normalize_offer_ids


def test_short_offer_id_is_unchanged() -> None:
    assert normalize_offer_id("KC000006-Локи") == "KC000006-Локи"


def test_long_offer_id_is_shortened_to_50_with_stable_hash() -> None:
    value = "KC000006-Чехол_для_телефона_с_дизайном_Человека-паука"
    result = normalize_offer_id(value)
    assert len(result) <= 50
    assert result.startswith("KC000006-")
    assert result == normalize_offer_id(value)
    assert result != value[:50]


def test_normalized_offer_ids_remain_unique_after_truncation() -> None:
    values = [
        "KC000006-Очень_длинное_название_варианта_одинаковая_часть-A",
        "KC000006-Очень_длинное_название_варианта_одинаковая_часть-B",
    ]
    results = normalize_offer_ids(values)
    assert len(set(results)) == 2
    assert all(len(value) <= 50 for value in results)
