import json
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.automation_service import execute_task, expand_search_keywords, exclusion_reason, package_limit_reason, resolve_search_keywords
from app.database import Base, get_db
from app.erp_models import AutomationCandidateRecord, AutomationRunRecord, AutomationTaskRecord
from app.models import Shop
from fastapi.testclient import TestClient
from app.main import app


def test_execute_task_keeps_missing_package_as_pending(monkeypatch, tmp_path):
    engine=create_engine(f"sqlite:///{tmp_path / 'automation.db'}")
    Base.metadata.create_all(engine)
    db_session=Session(engine)
    shop=Shop(name="自动化测试店",currency="CNY",timezone="Asia/Shanghai",is_active=True)
    db_session.add(shop);db_session.commit();db_session.refresh(shop)
    task = AutomationTaskRecord(name="收纳", keywords_json='["收纳盒"]', excluded_keywords_json="[]",
        filters_json=json.dumps({"min_price": 1, "max_price": 50, "min_sales_90d": 10,
                                "min_stock": 1, "require_complete_package": True, "require_48h_shipping": False}),
        daily_target=10, schedule_time="09:00", status="paused")
    db_session.add(task); db_session.commit(); db_session.refresh(task)
    monkeypatch.setattr("app.automation_service.search_jxhy_products", lambda *a, **k: {"items": [
        {"offer_id":"1","title":"完整商品","image_url":"https://x/a.jpg","url":"https://detail/1","price_min":5,"sales_90d":100},
        {"offer_id":"2","title":"缺尺重商品","image_url":"https://x/b.jpg","url":"https://detail/2","price_min":6,"sales_90d":100},
    ]})
    monkeypatch.setattr("app.automation_service.get_product_details", lambda ids: [{"id": oid} for oid in ids])
    def convert(detail):
        oid=detail["id"]; complete=oid=="1"
        return ({"offerId":oid,"title":f"商品{oid}","url":f"https://detail/{oid}","images":[f"https://x/{oid}.jpg"],
                 "skuVariants":[{"skuId":"s1","spec":"默认","price":5,"stock":9,"weightG":100 if complete else None,
                                 "lengthMm":100 if complete else None,"widthMm":80 if complete else None,"heightMm":50 if complete else None}],
                 "packageInfo":{},"attributes":[],"description":""},
                {"offer_id":oid,"has_complete_package":complete,"variant_count":1,"complete_variant_count":1 if complete else 0})
    monkeypatch.setattr("app.automation_service.detail_to_capture", convert)
    run=execute_task(db_session,task,shop.id)
    assert run.collected_count==1 and run.failed_count==1
    statuses={row.offer_id:row.status for row in db_session.query(AutomationCandidateRecord).all()}
    assert statuses=={"1":"ready_for_review","2":"package_pending"}
    ready = db_session.query(AutomationCandidateRecord).filter_by(offer_id="1").one()
    assert ready.shop_id is None and ready.source_record_id is None and ready.capture_json


def test_task_shop_scope_is_persisted(monkeypatch, tmp_path):
    engine=create_engine(f"sqlite:///{tmp_path / 'scope.db'}");Base.metadata.create_all(engine)
    with Session(engine) as db:
        task=AutomationTaskRecord(name="范围",keywords_json='["盒"]',excluded_keywords_json="[]",
            filters_json=json.dumps({"shop_ids":[2,4],"require_complete_package":True}),daily_target=10,schedule_time="09:00")
        db.add(task);db.commit();db.refresh(task)
        assert json.loads(task.filters_json)["shop_ids"]==[2,4]


def isolated_client():
    from app.database import get_db
    engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool);Base.metadata.create_all(engine)
    def override_db():
        with Session(engine) as db: yield db
    app.dependency_overrides[get_db]=override_db
    return TestClient(app)


def test_task_management_routes_do_not_run_external_jobs(monkeypatch):
    client=isolated_client()
    payload={"name":"接口任务","keywords":["收纳"],"excluded_keywords":[],"min_sales_90d":1,
             "min_stock":1,"require_complete_package":True,"require_48h_shipping":False,
             "daily_target":5,"schedule_time":"09:30","shop_ids":[]}
    created=client.post("/api/v1/automation/tasks",json=payload)
    assert created.status_code==201
    assert created.json()["status"]=="active"
    task_id=created.json()["id"]
    payload["name"]="已编辑任务";payload["shop_ids"]=[1,2]
    updated=client.put(f"/api/v1/automation/tasks/{task_id}",json=payload)
    assert updated.status_code==200 and updated.json()["name"]=="已编辑任务"
    assert updated.json()["filters"]["shop_ids"]==[1,2]
    copied=client.post(f"/api/v1/automation/tasks/{task_id}/copy")
    assert copied.status_code==201 and copied.json()["status"]=="active"
    try:
        archived=client.delete(f"/api/v1/automation/tasks/{task_id}")
        assert archived.status_code==200 and archived.json()["status"]=="archived"
    finally: app.dependency_overrides.clear()


def test_manual_listing_start_requires_operator_shop_choice(monkeypatch):
    client=isolated_client()
    try:
        with next(app.dependency_overrides[get_db]()) as db:
            shop=Shop(name="人工店",currency="CNY",timezone="Asia/Shanghai",is_active=True); db.add(shop); db.commit(); db.refresh(shop)
            task=AutomationTaskRecord(name="夜间",keywords_json='["收纳"]',excluded_keywords_json="[]",filters_json="{}",daily_target=1,schedule_time="01:00")
            db.add(task); db.commit(); db.refresh(task)
            run=AutomationRunRecord(task_id=task.id,status="completed"); db.add(run); db.commit(); db.refresh(run)
            candidate=AutomationCandidateRecord(run_id=run.id,task_id=task.id,offer_id="1688-1",title="候选",status="ready_for_review",capture_json='{"offerId":"1688-1","title":"候选","skuVariants":[],"images":[]}')
            db.add(candidate); db.commit(); db.refresh(candidate); candidate_id=candidate.id; shop_id=shop.id
        monkeypatch.setattr("app.automation_routes.ingest_capture",lambda db, shop_id, capture:{"id":"88"})
        response=client.post(f"/api/v1/automation/candidates/{candidate_id}/start-manual-listing",json={"shop_id":shop_id})
        assert response.status_code==200
        assert response.json()["status"]=="manual_editing"
        with next(app.dependency_overrides[get_db]()) as db:
            candidate=db.get(AutomationCandidateRecord,candidate_id)
            assert candidate.shop_id==shop_id and candidate.source_record_id==88
    finally: app.dependency_overrides.clear()


def test_overview_exposes_latest_run_and_result_detail():
    client=isolated_client()
    try:
        overview=client.get("/api/v1/automation/overview")
        assert overview.status_code==200 and overview.json()["tasks"]==[]
    finally: app.dependency_overrides.clear()


def test_execute_task_pages_until_source_exhausted(monkeypatch,tmp_path):
    engine=create_engine(f"sqlite:///{tmp_path / 'pages.db'}");Base.metadata.create_all(engine)
    with Session(engine) as db:
        shop=Shop(name="翻页店",currency="CNY",timezone="Asia/Shanghai",is_active=True);db.add(shop);db.commit();db.refresh(shop)
        task=AutomationTaskRecord(name="翻页",keywords_json='["模具"]',excluded_keywords_json="[]",
            filters_json=json.dumps({"min_stock":1,"require_complete_package":True}),daily_target=2,schedule_time="09:00")
        db.add(task);db.commit();db.refresh(task);pages=[]
        def search(*args,**kwargs):
            page=kwargs["page_num"];pages.append(page)
            return {"page_num":page,"page_size":1,"total":3,"items":[{"offer_id":str(page),"title":f"商品{page}","price_min":5,"sales_90d":1}]}
        monkeypatch.setattr("app.automation_service.search_jxhy_products",search)
        monkeypatch.setattr("app.automation_service.get_product_details",lambda ids:[{"id":oid} for oid in ids])
        monkeypatch.setattr("app.automation_service.detail_to_capture",lambda d:({"offerId":d["id"],"title":"商品","skuVariants":[{"skuId":"s","stock":2,"weightG":1,"lengthMm":1,"widthMm":1,"heightMm":1}]},{"offer_id":d["id"],"has_complete_package":True,"variant_count":1,"complete_variant_count":1}))
        run=execute_task(db,task,shop.id)
        assert pages[:3]==[1,2,3] and all(page in {1,2,3} for page in pages)
        assert run.collected_count==2
        assert run.discovered_count==3  # duplicate offers from expanded terms stay deduplicated


def test_silicone_mold_keyword_expansion_is_deduplicated():
    words=expand_search_keywords(["硅胶模具","硅胶模具"])
    assert words[0]=="硅胶模具"
    assert "烘焙硅胶模具" in words and "冰格硅胶模具" in words
    assert len(words)==len(set(words)) and len(words)>8


def test_empty_keywords_use_system_exploration_rotation():
    words, exploration = resolve_search_keywords([])
    assert exploration is True
    assert words
    assert words[0] == "家居用品"
    assert len(words) == len(set(words))


def test_risk_and_oversize_rules_cover_unattended_sourcing_scope():
    assert exclusion_reason("儿童驱蚊液喷雾") == "液体或喷雾类"
    assert exclusion_reason("农用杀虫剂") == "农资、农药或驱虫液"
    assert exclusion_reason("女士连衣裙") == "服装鞋靴高退货类"
    assert exclusion_reason("工业环氧树脂原材料") == "工业品或原材料"
    assert package_limit_reason({"product_package":{"weightG":2100}}).startswith("重量")
    assert package_limit_reason({"product_package":{"weightG":100,"lengthMm":410,"widthMm":50,"heightMm":50}}).startswith("单边")
    assert package_limit_reason({"product_package":{"weightG":100,"lengthMm":400,"widthMm":300,"heightMm":200}}).startswith("体积")
