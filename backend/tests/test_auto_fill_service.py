from app import auto_fill_service


def test_dictionary_ai_text_without_current_menu_id_is_left_manual(monkeypatch) -> None:
    """Dictionary attributes must never become a text-only AI guess."""
    monkeypatch.setattr(auto_fill_service, "recommend_attribute_memories", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(auto_fill_service, "get_category_attributes", lambda *_: [{
        "id": "8229", "name": "类型", "description": "", "required": True,
        "dictionary_id": "1", "is_collection": False,
    }])
    monkeypatch.setattr(auto_fill_service, "search_category_attribute_values", lambda *_args, **_kwargs: [
        {"id": "100", "value": "洗碗刷"},
    ])
    monkeypatch.setattr(auto_fill_service, "suggest_attribute_value", lambda *_args, **_kwargs: {
        "value_id": None, "value": "锅",
    })

    result = auto_fill_service.auto_fill_attributes(
        db=None, shop_id=1, category_id="10", type_id="20",
        source_product={"title": "厨房清洁工具", "raw_json": {}},
    )

    assert result == [{
        "attribute_id": "8229", "name": "类型", "value_id": None,
        "value_text": None, "method": "manual", "required": True,
    }]


def test_dictionary_ai_selection_uses_the_canonical_menu_option(monkeypatch) -> None:
    monkeypatch.setattr(auto_fill_service, "recommend_attribute_memories", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(auto_fill_service, "get_category_attributes", lambda *_: [{
        "id": "8229", "name": "类型", "description": "", "required": True,
        "dictionary_id": "1", "is_collection": False,
    }])
    monkeypatch.setattr(auto_fill_service, "search_category_attribute_values", lambda *_args, **_kwargs: [
        {"id": "100", "value": "洗碗刷"},
    ])
    monkeypatch.setattr(auto_fill_service, "suggest_attribute_value", lambda *_args, **_kwargs: {
        "value_id": "100", "value": "任意模型幻觉文字",
    })

    result = auto_fill_service.auto_fill_attributes(
        db=None, shop_id=1, category_id="10", type_id="20",
        source_product={"title": "厨房清洁工具", "raw_json": {}},
    )

    assert result[0]["value_id"] == "100"
    assert result[0]["value_text"] == "洗碗刷"
    assert result[0]["method"] == "ai_match"
