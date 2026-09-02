from app.pipeline.local_ocr import exclusion_reasons_for_ocr_text


def test_policy_text_is_always_excluded_even_without_optional_filters():
    assert exclusion_reasons_for_ocr_text("Trans rights are human rights") == [
        "prohibited_lgbt_symbolism"
    ]


def test_ordinary_image_text_is_not_excluded_by_policy_gate():
    assert exclusion_reasons_for_ocr_text("Metal heart pin, 3 cm") == []


def test_policy_and_marketing_reasons_are_both_retained_for_audit():
    reasons = exclusion_reasons_for_ocr_text(
        "Rainbow pride promotion", remove_marketing=True
    )
    assert "prohibited_lgbt_symbolism" in reasons
    assert "marketing" in reasons
