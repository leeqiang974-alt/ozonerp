import inspect


def test_bulk_worker_does_not_treat_ocr_or_preflight_failure_as_warning():
    from app import automation_routes

    source = inspect.getsource(automation_routes._run_bulk_listing_pilot)
    assert 'code == "local_ocr_failed"' not in source
    assert 'code": "quality_preflight_failed"' in source
