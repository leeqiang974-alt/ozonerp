from types import SimpleNamespace

from app.ozon_content_compliance import evaluate_draft_content


def _draft(*, title: str = "Товар для дома", description: str = "Практичный товар.", attributes=None):
    return SimpleNamespace(title=title, description=description, attribute_values=attributes or [])


def test_blocks_off_platform_promotion_contacts_and_logistics():
    issues = evaluate_draft_content(_draft(
        title="Товар со скидкой",
        description="Закажите на www.example.ru, доставка 2 дня, Telegram +7 999 123-45-67",
    ))
    assert {item.rule_id for item in issues} >= {
        "promotion_or_competition", "contact_or_external_link", "logistics_or_returns",
    }


def test_blocks_counterfeit_random_style_and_adult_terms():
    issues = evaluate_draft_content(_draft(
        description="Реплика 1:1, случайный цвет, вейп",
    ))
    assert {item.rule_id for item in issues} >= {
        "counterfeit_or_originality_claim", "random_style_listing", "adult_tobacco_or_profanity",
    }


def test_rich_content_scans_text_but_allows_its_image_url():
    rich = '{"content":[{"type":"image","url":"https://cdn.example.com/a.jpg"},{"type":"text","text":"Промокод SALE"}]}'
    attribute = SimpleNamespace(attribute_id="11254", value_text=rich)
    issues = evaluate_draft_content(_draft(attributes=[attribute]))
    assert {item.rule_id for item in issues} == {"promotion_or_competition"}


def test_title_limits_and_ordinary_colour_terms_are_precise():
    title = "Радужный градиент " + ("сверхдлинноеслово" * 2)
    issues = evaluate_draft_content(_draft(title=title))
    assert "title_word_over_27" in {item.rule_id for item in issues}
    assert "counterfeit_or_originality_claim" not in {item.rule_id for item in issues}
