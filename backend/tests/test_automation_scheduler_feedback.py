from types import SimpleNamespace

import app.automation_scheduler as scheduler
from app.automation_scheduler import _auto_repairable_feedback, _feedback_rows


def test_feedback_rows_preserve_offer_and_nested_ozon_message():
    rows = _feedback_rows({
        "task_id": "task-1",
        "publish_status": "import_failed",
        "errors": [{
            "offer_id": "OZE66808F4F5",
            "errors": [{
                "code": "BR_hashtag_brand",
                "level": "error",
                "description": "brand in hashtag",
            }],
        }],
    })
    assert rows == [{
        "type": "ozon_error",
        "offer_id": "OZE66808F4F5",
        "code": "BR_hashtag_brand",
        "field": "",
        "level": "error",
        "attribute_id": None,
        "attribute_name": "",
        "description": "brand in hashtag",
    }]


def test_text_feedback_is_auto_repairable_but_image_moderation_is_not():
    assert _auto_repairable_feedback([{"code": "BR_hashtag_brand"}]) is True
    assert _auto_repairable_feedback([{
        "code": "DESCRIPTION_DECLINE",
        "description": "На дополнительном фото есть нецензурная лексика",
    }]) is False


def test_quota_feedback_is_not_auto_repairable():
    assert _auto_repairable_feedback([{
        "code": "periodic_limit_exceeded",
        "description": "daily create quota",
    }]) is False


def test_legacy_feedback_sweep_isolates_one_row_failure(monkeypatch):
    """A broken historical row must not prevent later rows being repaired."""
    class QueryStub:
        def join(self, *args, **kwargs):
            return self

        def where(self, *args, **kwargs):
            return self

        def order_by(self, *args, **kwargs):
            return self

        def limit(self, *args, **kwargs):
            return self

    first_item = SimpleNamespace(id=1, attempts=1)
    second_item = SimpleNamespace(id=2, attempts=1)
    first_draft = SimpleNamespace(ozon_issues_json='[{"code":"BR_hashtag_brand"}]')
    second_draft = SimpleNamespace(ozon_issues_json='[{"code":"BR_hashtag_marketing"}]')
    first_candidate = SimpleNamespace()
    second_candidate = SimpleNamespace()
    repaired_row = SimpleNamespace(id=1, status="needs_review", error_message=None)

    class DbStub:
        def execute(self, query):
            return SimpleNamespace(all=lambda: [
                (first_item, first_draft, first_candidate),
                (second_item, second_draft, second_candidate),
            ])

        def rollback(self):
            return None

        def get(self, model, item_id):
            return repaired_row if item_id == 1 else None

        def commit(self):
            return None

    calls = []

    def fake_repair(db, candidate, item, rows):
        calls.append(item.id)
        if item.id == 1:
            raise RuntimeError("malformed legacy row")
        return True

    monkeypatch.setattr(scheduler, "select", lambda *args, **kwargs: QueryStub())
    monkeypatch.setattr(scheduler, "_try_auto_repair_and_resubmit", fake_repair)

    repaired = scheduler._repair_existing_bulk_feedback(DbStub(), limit=10)

    assert repaired == 1
    assert calls == [1, 2]
    assert repaired_row.status == "needs_review"
    assert repaired_row.error_message.startswith("历史回扫异常")


def test_legacy_feedback_sweep_archives_items_at_retry_budget(monkeypatch):
    class QueryStub:
        def join(self, *args, **kwargs): return self
        def where(self, *args, **kwargs): return self
        def order_by(self, *args, **kwargs): return self
        def limit(self, *args, **kwargs): return self

    item = SimpleNamespace(id=7, attempts=3, status="needs_review", assigned_shop_id=2,
                           error_message="old error")
    draft = SimpleNamespace(ozon_issues_json='[{"code":"BR_hashtag_brand"}]')
    candidate = SimpleNamespace()
    audit_events = []

    class DbStub:
        def execute(self, query):
            return SimpleNamespace(all=lambda: [(item, draft, candidate)])
        def add(self, value): audit_events.append(value)
        def commit(self): return None

    def must_not_repair(*args, **kwargs):
        raise AssertionError("retry budget exhausted item was repaired")

    monkeypatch.setattr(scheduler, "select", lambda *args, **kwargs: QueryStub())
    monkeypatch.setattr(scheduler, "_try_auto_repair_and_resubmit", must_not_repair)

    assert scheduler._repair_existing_bulk_feedback(DbStub(), limit=10) == 0
    assert item.status == "skipped"
    assert "达到3次或以上" in item.error_message
    assert audit_events
