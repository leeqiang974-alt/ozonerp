from app.ai_service import normalize_hashtags


def test_hashtags_accept_20_to_30() -> None:
    tags = [f"#{letter}" for letter in "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"[:29]]
    result = normalize_hashtags(" ".join(tags))
    assert result == tags


def test_hashtags_are_deduplicated_and_capped() -> None:
    tags = [f"#{letter}" for letter in "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"]
    result = normalize_hashtags(" ".join(tags + ["#а", "#б"]))
    assert len(result) == 30
    assert result[0] == "#а"
    assert len(set(result)) == 30


def test_short_but_valid_hashtags_do_not_block_publishing() -> None:
    tags = ["#значок", "#брошь", "#булавка"]
    assert normalize_hashtags(" ".join(tags)) == tags
