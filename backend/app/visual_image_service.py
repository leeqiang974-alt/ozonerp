"""AI Ozon image-set workflow. Generated images remain drafts until explicitly applied."""
from __future__ import annotations

import base64, ipaddress, json, os, re, socket, time, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal
from .erp_models import AuditEventRecord, ListingDraftRecord, SourceMediaRecord, SourceProductRecord, SourceProductShopRecord, SourceVariantRecord, VisualImageJobRecord
from .secret_paths import api_file

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "frontend" / "generated" / "ai-images"
PUBLIC_PREFIX = os.getenv("GENERATED_IMAGE_PUBLIC_BASE", "http://127.0.0.1:5500/generated/ai-images").rstrip("/")
STYLE_LOCK = "premium Ozon ecommerce system; warm off-white #F7F2EA, deep charcoal text, restrained metallic-gold accents, modern geometric sans-serif, thin-line icons, neutral-warm studio light, generous whitespace"
PRODUCT_GROUP_KEY = "__product__"
AI_IMAGE_SLOTS = [
    "hero", "dimensions", "details", "steps", "lifestyle",
    "scene_home", "scene_entry", "scene_gift",
]


def loads(value: str | None, fallback: Any) -> Any:
    try: return json.loads(value or "")
    except (TypeError, json.JSONDecodeError): return fallback


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _history(job: VisualImageJobRecord) -> list[dict[str, Any]]:
    value = loads(getattr(job, "attempt_history_json", "[]"), [])
    return value if isinstance(value, list) else []


def _save_history(db: Session, job: VisualImageJobRecord, history: list[dict[str, Any]]) -> None:
    # Keep the ledger bounded while retaining enough evidence for normal
    # operator review. Older runs remain represented by the job audit trail.
    job.attempt_history_json = json.dumps(history[-300:], ensure_ascii=False)
    db.commit()


def _run_entry(history: list[dict[str, Any]], run_id: str) -> dict[str, Any] | None:
    return next((item for item in reversed(history) if item.get("kind") == "run" and item.get("run_id") == run_id), None)


def _attempt_entry(history: list[dict[str, Any]], run_id: str, slot: str) -> dict[str, Any] | None:
    return next((item for item in reversed(history) if item.get("kind") == "image_request" and item.get("run_id") == run_id and item.get("slot") == slot), None)


def _new_run(db: Session, job: VisualImageJobRecord, requested_slots: list[str] | None = None) -> tuple[str, list[dict[str, Any]]]:
    run_id = uuid.uuid4().hex
    history = _history(job)
    history.append({"kind": "run", "run_id": run_id, "state": "queued", "created_at": _timestamp(), "creative_group_key": job.creative_group_key, "requested_slots": requested_slots or AI_IMAGE_SLOTS})
    job.current_run_id = run_id
    _save_history(db, job, history)
    return run_id, history


def _update_run(db: Session, job: VisualImageJobRecord, run_id: str, state: str, **fields: Any) -> list[dict[str, Any]]:
    history = _history(job)
    entry = _run_entry(history, run_id)
    if entry:
        entry["state"] = state
        entry.update(fields)
    _save_history(db, job, history)
    return history


def reconcile_interrupted_jobs(db: Session) -> int:
    """Mark in-memory workers lost during restart without replaying paid calls."""
    jobs = list(db.scalars(select(VisualImageJobRecord).where(
        VisualImageJobRecord.status.in_(["queued", "analyzing", "generating"])
        | ((VisualImageJobRecord.status == "interrupted") & (VisualImageJobRecord.error_message.like("%未持久化到供应商请求阶段%")))
    )))
    for job in jobs:
        history = _history(job)
        # Jobs created before the ledger existed have no evidence at all. They
        # must also be treated as charge-unknown rather than falsely reported
        # as definitely unsent.
        legacy_unknown = not history
        unknown = legacy_unknown
        for item in history:
            if item.get("kind") == "image_request" and item.get("state") in {"provider_requesting", "response_received"}:
                item["state"] = "interrupted_unknown"
                item["interrupted_at"] = _timestamp()
                unknown = True
        if job.current_run_id:
            run = _run_entry(history, job.current_run_id)
            if run:
                run["state"] = "interrupted"
                run["interrupted_at"] = _timestamp()
        job.status = "interrupted"
        job.error_message = (
            "后端进程在生图请求期间重启；旧任务没有供应商请求账本，是否已发送/扣费无法确认。任务已停止且不会自动重试，请查沧猿调用明细后再人工重试。"
            if legacy_unknown else
            "后端进程在供应商请求已发送或结果保存期间重启；请求账本已保留，但是否计费仍以沧猿调用明细为准。任务已停止且不会自动重试，已生成图片可以继续使用。"
            if unknown else
            "后端进程在任务尚未发送下一张图片前重启；任务已停止且不会自动重试，已生成图片可以继续使用。"
        )
        job.attempt_history_json = json.dumps(history[-300:], ensure_ascii=False)
    if jobs:
        db.commit()
    return len(jobs)


def _keys() -> dict[str, str]:
    result: dict[str, str] = {}
    path = Path(os.getenv("CANGYUAN_API_KEY_FILE", str(api_file("cangyuanapi.txt"))))
    if path.is_file():
        for raw in path.read_text(encoding="utf-8").splitlines():
            if "=" in raw:
                name, value = raw.split("=", 1); result[name.strip()] = value.strip()
    return result


def llm_config() -> tuple[str, str, str]:
    keys = _keys()
    agnes = (os.getenv("AGNES_API_KEY", "").strip() or keys.get("AGNES_API_KEY", "")).strip()
    if agnes:
        # Agnes route: OpenAI-compatible chat/completions, vision-capable.
        # Use a dedicated model var so legacy Cangyuan VISUAL_LLM_MODEL env
        # cannot leak the wrong model name into the Agnes route.
        return (agnes, "https://apihub.agnes-ai.com/v1", os.getenv("AGNES_VISUAL_LLM_MODEL", "agnes-2.5-flash"))
    return (os.getenv("VISUAL_LLM_API_KEY", "").strip() or keys.get("LLM_API_KEY", ""), os.getenv("VISUAL_LLM_BASE_URL", "https://ai.cangyuansuanli.cn/v1").rstrip("/"), os.getenv("VISUAL_LLM_MODEL", "gpt-5.6-terra"))


def image_config() -> tuple[str, str, str]:
    keys = _keys()
    agnes = (os.getenv("AGNES_API_KEY", "").strip() or keys.get("AGNES_API_KEY", "")).strip()
    if agnes:
        # Agnes route: /v1/images/generations JSON endpoint.
        # Dedicated model var so legacy Cangyuan IMAGE_MODEL env cannot leak
        # the wrong model name into the Agnes route.
        return (agnes, "https://apihub.agnes-ai.com/v1", os.getenv("AGNES_IMAGE_MODEL", "agnes-image-2.5-flash"))
    # Cangyuan's ¥0.015/image product is exposed as the exact ID gpt-image-2.
    # Normalize legacy shorthand/1K aliases so an old environment cannot route
    # ERP jobs to the cheaper 1K channel by accident.
    requested = os.getenv("IMAGE_MODEL", "gpt-image-2").strip().lower()
    if requested in {"imag-2", "image-2", "gpt-image-2-1k", "image-2-1k"}:
        requested = "gpt-image-2"
    return (os.getenv("IMAGE_API_KEY", "").strip() or keys.get("IMAGE_API_KEY", ""), os.getenv("IMAGE_BASE_URL", "https://ai.cangyuansuanli.cn/v1").rstrip("/"), requested)


def chat_json(messages: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    key, base, model = llm_config()
    if not key: raise RuntimeError("VISUAL_LLM_API_KEY/LLM_API_KEY 未配置")
    payload = {"model": model, "messages": messages, "temperature": 0.1, "max_tokens": 5000}
    last = ""
    for attempt, wait in enumerate((0, 2, 5)):
        if wait: time.sleep(wait)
        try:
            response = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=90)
            if response.is_error:
                # Preserve the provider's validation message; a bare 400 is not
                # actionable when diagnosing one malformed reference image.
                detail = response.text.strip().replace("\n", " ")[:600]
                raise RuntimeError(f"HTTP {response.status_code}: {detail}")
            body = response.json(); choices = body.get("choices") or []
            if not choices: raise RuntimeError("LLM返回空choices")
            text = choices[0].get("message", {}).get("content") or choices[0].get("message", {}).get("reasoning_content") or ""
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
            return json.loads(text), body.get("usage") or {}
        except Exception as exc: last = str(exc)
    raise RuntimeError(f"Terra图片分析失败：{last[:500]}")


def _source_variant_group(variant: SourceVariantRecord) -> tuple[str, str]:
    """Return a stable style key/label without inventing a cartesian SKU grid."""
    raw = loads(variant.raw_json, {})
    structured = raw.get("specs") or raw.get("skuSpecs") or raw.get("spec") or []
    if isinstance(structured, str):
        structured = loads(structured, [])
    if isinstance(structured, list):
        for item in structured:
            if not isinstance(item, dict):
                continue
            name = str(item.get("attributeName") or item.get("name") or "").strip()
            value = str(item.get("attributeValue") or item.get("value") or "").strip()
            lower = name.lower()
            if value and not any(token in lower for token in ("尺寸", "尺码", "大小", "size", "dimension", "规格")):
                return (f"{name}:{value}", value)
    spec = str(variant.spec_name or "").strip()
    try:
        parsed = loads(spec, [])
        if isinstance(parsed, list):
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("attributeName") or item.get("name") or "").strip()
                value = str(item.get("attributeValue") or item.get("value") or "").strip()
                lower = name.lower()
                if value and not any(token in lower for token in ("尺寸", "尺码", "大小", "size", "dimension", "规格")):
                    return (f"{name}:{value}", value)
    except Exception:
        pass
    first = re.split(r"[|/\\,，;；]\s*|\s+-\s+", spec)[0].strip()
    return (f"spec:{first}" if first else PRODUCT_GROUP_KEY, first or "全部款式")


def source_bundle(db: Session, shop_id: int, source_id: int, creative_group_key: str = PRODUCT_GROUP_KEY):
    product = db.scalar(select(SourceProductRecord).join(SourceProductShopRecord, SourceProductShopRecord.source_product_id == SourceProductRecord.id).where(SourceProductRecord.id == source_id, SourceProductShopRecord.shop_id == shop_id, SourceProductShopRecord.is_deleted.is_(False)))
    if not product: raise ValueError("采集商品不存在或不属于当前店铺")
    variants = list(db.scalars(select(SourceVariantRecord).where(SourceVariantRecord.source_product_id == source_id).order_by(SourceVariantRecord.id)))
    if creative_group_key != PRODUCT_GROUP_KEY:
        variants = [variant for variant in variants if _source_variant_group(variant)[0] == creative_group_key]
        if not variants:
            raise ValueError("所选款式不再属于当前采集商品，请刷新变体后重试")
    media = list(db.scalars(select(SourceMediaRecord).where(SourceMediaRecord.source_product_id == source_id).order_by(SourceMediaRecord.sort_order, SourceMediaRecord.id)))
    return product, variants, media


def analyze(db: Session, shop_id: int, source_id: int, creative_group_key: str = PRODUCT_GROUP_KEY):
    product, variants, media = source_bundle(db, shop_id, source_id, creative_group_key)
    urls: list[str] = []
    for url in [product.main_image_url, *[v.image_url for v in variants], *[m.url for m in media if m.media_type == "image"]]:
        if url and url not in urls: urls.append(url)
    # Cangyuan's Terra endpoint accepts the OpenAI image_url content shape, but
    # rejects malformed/non-HTTP source entries. Filter those before building
    # the request so one bad scraped asset cannot invalidate the whole analysis.
    urls = [url for url in urls[:12] if urlparse(url).scheme in {"http", "https"} and urlparse(url).netloc]
    instruction = (
        "你是Ozon商品视觉分析器。结合标题、SKU和图片严格输出JSON，不得虚构。区分在售主体和示例成品；识别尺寸证据、不可修改结构、包装不包含物、图片角色及SKU差异。"
        "键必须为sold_product,product_truth,dimensions,not_included,image_assets,reference_urls,sku_strategy,sku_risks,manual_review_required,content_safety,confidence。"
        "image_assets中逐张记录role、可读文字OCR、是否适合作为唯一生图参考及原因；reference_urls只能返回1张最适合保持产品外观的原图。"
        "content_safety 必须包含 prohibited_lgbt_symbolism 布尔值和 reasons 数组。若图片或文案出现 LGBT/跨性别/彩虹旗等非传统性关系宣传或其文字（例如 trans rights），该值必须为 true，"
        "并且 reference_urls 必须为空、manual_review_required 必须为 true。"
        f"\n标题：{product.title}\n材质：{product.material or ''}\nSKU：{json.dumps([{'sku':v.source_sku,'spec':v.spec_name,'image_url':v.image_url} for v in variants], ensure_ascii=False)}\n图片URL：{json.dumps(urls, ensure_ascii=False)}"
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": instruction}]
    content += [{"type": "image_url", "image_url": {"url": url}} for url in urls]
    result, usage = chat_json([{"role": "user", "content": content}])
    # Terra may inspect a larger source gallery, but paid Image 2 editing is
    # deliberately single-reference: a single verified product image is more
    # deterministic than mixing product, dimension and promotional assets.
    style_urls = [v.image_url for v in variants if v.image_url in urls]
    refs = style_urls[:1] or [u for u in (result.get("reference_urls") or []) if u in urls][:1] or urls[:1]
    return result, refs, usage


def plan(product: SourceProductRecord, analysis: dict[str, Any], creative_group_label: str = "") -> list[dict[str, str]]:
    facts = json.dumps(analysis.get("product_truth") or {}, ensure_ascii=False)
    dims = json.dumps(analysis.get("dimensions") or {}, ensure_ascii=False)
    excluded = json.dumps(analysis.get("not_included") or [], ensure_ascii=False)
    group_lock = f" STYLE VARIANT LOCK: this is only style '{creative_group_label}'. Never use another style, pattern, colourway or SKU image." if creative_group_label else ""
    common = f"Campaign Style Lock: {STYLE_LOCK}. PRODUCT TRUTH LOCK: sold product {analysis.get('sold_product') or product.title}; visible facts {facts}; not included {excluded}.{group_lock} Preserve exact identity, quantity, color, structure and visible hardware. Russian Ozon ecommerce image, vertical 3:4, crisp short Russian text. No Chinese, English, price, watermark, QR, fake certification or invented specifications. Never create, retain, or embellish LGBT/sexual-orientation/gender-identity messaging, rainbow/pride flags, transgender symbols, or related slogans."
    return [
        {"slot":"hero","title":"销售首图","prompt":common+" Premium hero infographic, product 38%, concise Russian headline and exactly three evidence-backed labels."},
        {"slot":"dimensions","title":"尺寸规格","prompt":common+f" E-commerce dimension infographic, top-down. Only verified dimensions: {dims}. If none, show structure without numbers."},
        {"slot":"details","title":"结构细节","prompt":common+" E-commerce detail infographic with one full product and two macro callouts of real visible structure/material."},
        {"slot":"steps","title":"使用步骤","prompt":common+" E-commerce three-step usage infographic based only on evidenced use; never imply tools are included."},
        {"slot":"lifestyle","title":"场景用途","prompt":common+" Premium lifestyle infographic with three believable uses, clearly labeled as examples, not package contents."},
        {"slot":"scene_home","title":"居家场景","prompt":common+" Premium believable home scene. Product is clearly visible and remains the exact selected style; no other styles in frame."},
        {"slot":"scene_entry","title":"玄关场景","prompt":common+" Premium believable entryway scene. Product is clearly visible and remains the exact selected style; no other styles in frame."},
        {"slot":"scene_gift","title":"礼赠场景","prompt":common+" Premium believable gift or seasonal scene only when supported by product truth; otherwise use a neutral lifestyle scene. Preserve the exact selected style."},
    ]


def _validate_public_image_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("参考图URL必须是公开的HTTP(S)地址")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError("参考图域名无法解析") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        if not ip.is_global:
            raise ValueError("参考图URL不得指向本机、内网或保留地址")


def download_ref(url: str, index: int):
    current = url
    with httpx.Client(timeout=45, follow_redirects=False, headers={"User-Agent":"Mozilla/5.0"}) as client:
        for _ in range(4):
            _validate_public_image_url(current)
            with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location: raise ValueError("参考图重定向缺少目标地址")
                    current = urljoin(current, location); continue
                response.raise_for_status()
                mime = response.headers.get("content-type", "").split(";",1)[0].lower()
                if mime not in {"image/jpeg","image/png","image/webp"}: raise ValueError("参考图不是支持的图片格式")
                data=bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data)>12*1024*1024: raise ValueError("参考图超过12MB限制")
                content=bytes(data)
                valid=(mime=="image/jpeg" and content.startswith(b"\xff\xd8\xff")) or (mime=="image/png" and content.startswith(b"\x89PNG\r\n\x1a\n")) or (mime=="image/webp" and content[:4]==b"RIFF" and content[8:12]==b"WEBP")
                if not valid: raise ValueError("参考图内容与图片格式不一致")
                break
        else: raise ValueError("参考图重定向次数过多")
    ext = {"image/png":"png","image/webp":"webp"}.get(mime,"jpg")
    return ("image", (f"reference-{index}.{ext}", content, mime))


def generate_one(
    prompt: str,
    refs: list[str],
    job_id: int,
    slot: str,
    before_provider_request: Any | None = None,
    after_provider_response: Any | None = None,
) -> tuple[str, dict[str, Any]]:
    key, base, model = image_config()
    if not key: raise RuntimeError("IMAGE_API_KEY未配置")
    # The analysis stage may inspect up to 12 URLs, but paid Image 2 receives
    # exactly one validated reference image. This avoids multipart gateway
    # failures and prevents dimensions/promotional images from changing the
    # product identity.
    files = [download_ref(refs[0], 0)] if refs else []
    request_meta = {"model": model, "size": "3:4", "n": 1, "reference_count": len(files), "slot": slot}
    if before_provider_request:
        before_provider_request(request_meta)
    # Agnes exposes an OpenAI-style JSON endpoint (/v1/images/generations) with
    # reference images passed as data URIs inside extra_body.image; Cangyuan
    # uses the older multipart /images/edits. Route on the provider.
    is_agnes = "agnes-ai.com" in base or str(model).startswith("agnes-")
    if is_agnes:
        payload: dict[str, Any] = {"model": model, "prompt": prompt, "size": "1K", "ratio": "3:4", "extra_body": {"response_format": "url"}}
        if files:
            _, (fname, content, mime) = files[0]
            payload["extra_body"]["image"] = [f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"]
        response = httpx.post(f"{base}/images/generations", headers={"Authorization": f"Bearer {key}"}, json=payload, timeout=240)
    else:
        response = httpx.post(f"{base}/images/edits", headers={"Authorization":f"Bearer {key}"}, data={"model":model,"prompt":prompt,"n":"1","size":"3:4"}, files=files, timeout=240)
    response_meta = {"http_status": response.status_code, "has_body": bool(response.content)}
    if after_provider_response:
        after_provider_response(response_meta)
    if response.is_error:
        # Keep the provider's actionable JSON/text. The previous implementation
        # raised_for_status() here and discarded the body, leaving only "HTTP 400".
        detail = response.text.strip()
        try:
            parsed = response.json()
            detail = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
        except ValueError:
            pass
        raise RuntimeError(f"Image 2请求失败（HTTP {response.status_code}，{json.dumps(request_meta, ensure_ascii=False)}）：{detail[:1400]}")
    try:
        body = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Image 2返回非JSON（{json.dumps(request_meta, ensure_ascii=False)}）：{response.text[:800]}") from exc
    items = body.get("data") or []
    if not items:
        raise RuntimeError(f"Image 2返回空data（{json.dumps(request_meta, ensure_ascii=False)}）：{json.dumps(body, ensure_ascii=False)[:1000]}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True); name = f"visual-{job_id}-{slot}-{int(time.time())}.png"; path = OUTPUT_DIR/name
    if items[0].get("b64_json"): path.write_bytes(base64.b64decode(items[0]["b64_json"]))
    elif items[0].get("url"):
        _download_generated_result(items[0]["url"], path)
    else: raise RuntimeError("Image 2结果没有url或b64_json")
    return f"{PUBLIC_PREFIX}/{name}", {**response_meta, "result_type": "b64_json" if items[0].get("b64_json") else "url"}


def _download_generated_result(url: str, path: Path, *, max_seconds: float = 150, max_bytes: int = 30 * 1024 * 1024) -> None:
    """Download a provider result with both idle and whole-transfer limits."""
    started = time.monotonic()
    total = 0
    try:
        timeout = httpx.Timeout(connect=20, read=30, write=30, pool=10)
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                with path.open("wb") as output:
                    for chunk in response.iter_bytes():
                        if time.monotonic() - started > max_seconds:
                            raise TimeoutError(f"生图结果下载超过{int(max_seconds)}秒")
                        total += len(chunk)
                        if total > max_bytes:
                            raise ValueError(f"生图结果超过{max_bytes // (1024 * 1024)}MB限制")
                        output.write(chunk)
        if total == 0:
            raise ValueError("生图结果下载为空")
    except Exception:
        path.unlink(missing_ok=True)
        raise


def serialize(job: VisualImageJobRecord | None) -> dict[str, Any]:
    if not job: return {"status":"not_started","generated_images":[]}
    return {"id":job.id,"shop_id":job.shop_id,"source_product_id":job.source_product_id,"creative_group_key":job.creative_group_key,"listing_draft_id":job.listing_draft_id,"status":job.status,"analysis":loads(job.analysis_json,{}),"plan":loads(job.plan_json,[]),"generated_images":loads(job.generated_images_json,[]),"selected_images":loads(job.selected_images_json,[]),"reference_images":loads(job.reference_images_json,[]),"error_message":job.error_message,"llm_model":job.llm_model,"image_model":job.image_model,"usage":loads(job.usage_json,{}),"attempt_history":_history(job),"current_run_id":job.current_run_id,"applied_by":job.applied_by,"applied_at":job.applied_at}


def generate_set(db: Session, shop_id: int, source_id: int, draft_id: int | None = None, requested_slots: list[str] | None = None, creative_group_key: str = PRODUCT_GROUP_KEY):
    product, grouped_variants, _ = source_bundle(db, shop_id, source_id, creative_group_key)
    group_label = _source_variant_group(grouped_variants[0])[1] if creative_group_key != PRODUCT_GROUP_KEY and grouped_variants else ""
    job = db.scalar(select(VisualImageJobRecord).where(VisualImageJobRecord.shop_id==shop_id,VisualImageJobRecord.source_product_id==source_id,VisualImageJobRecord.creative_group_key==creative_group_key))
    if not job: job=VisualImageJobRecord(shop_id=shop_id,source_product_id=source_id,creative_group_key=creative_group_key); db.add(job); db.flush()
    job.listing_draft_id=draft_id or job.listing_draft_id; job.status="analyzing"; job.error_message=None; db.commit()
    run_id = job.current_run_id
    if not run_id:
        run_id, _ = _new_run(db, job)
    _update_run(db, job, run_id, "analyzing", started_at=_timestamp())
    try:
        analysis, refs, usage = analyze(db,shop_id,source_id,creative_group_key)
        content_safety = analysis.get("content_safety") if isinstance(analysis, dict) else {}
        if isinstance(content_safety, dict) and content_safety.get("prohibited_lgbt_symbolism") is True:
            raise ValueError("图片分析命中 Ozon 禁止的 LGBT/非传统性别关系宣传内容；禁止生图，必须人工移除相关素材或归档商品")
        image_plan=plan(product,analysis,group_label)
        if requested_slots:
            requested = set(requested_slots)
            image_plan = [item for item in image_plan if item.get("slot") in requested]
            if not image_plan:
                raise ValueError("没有可生成的图片槽位")
        job.analysis_json=json.dumps(analysis,ensure_ascii=False); job.reference_images_json=json.dumps(refs,ensure_ascii=False); job.plan_json=json.dumps(image_plan,ensure_ascii=False); job.usage_json=json.dumps({"analysis":usage},ensure_ascii=False); job.llm_model=llm_config()[2]; job.image_model=image_config()[2]; job.status="generating"; db.commit()
        _update_run(db, job, run_id, "generating", analysis_completed_at=_timestamp(), planned_slots=[item["slot"] for item in image_plan])
        # Keep successful files from earlier runs visible until a replacement
        # for the same slot succeeds. Starting a retry must never erase usable
        # paid output merely because Terra or a later slot fails.
        generated=loads(job.generated_images_json,[])
        generated=generated if isinstance(generated,list) else []
        generated_this_run=0
        failures=[]
        for item in image_plan:
            history = _history(job)
            attempt = {"kind": "image_request", "run_id": run_id, "slot": item["slot"], "state": "preparing_reference", "started_at": _timestamp()}
            history.append(attempt)
            job.attempt_history_json = json.dumps(history[-300:], ensure_ascii=False)
            db.commit()

            def mark_provider_request(meta: dict[str, Any], attempt: dict[str, Any] = attempt) -> None:
                current = _history(job)
                entry = _attempt_entry(current, run_id, attempt["slot"])
                if entry:
                    entry["state"] = "provider_requesting"
                    entry["provider_request_started_at"] = _timestamp()
                    entry["request"] = meta
                job.attempt_history_json = json.dumps(current[-300:], ensure_ascii=False)
                db.commit()

            def mark_provider_response(meta: dict[str, Any], attempt: dict[str, Any] = attempt) -> None:
                current = _history(job)
                entry = _attempt_entry(current, run_id, attempt["slot"])
                if entry:
                    entry["state"] = "response_received"
                    entry["provider_response_at"] = _timestamp()
                    entry["response"] = meta
                job.attempt_history_json = json.dumps(current[-300:], ensure_ascii=False)
                db.commit()

            try:
                url, response_meta = generate_one(item["prompt"], refs, job.id, item["slot"], mark_provider_request, mark_provider_response)
                current = _history(job); entry = _attempt_entry(current, run_id, item["slot"])
                if entry:
                    entry["state"] = "succeeded"
                    entry["completed_at"] = _timestamp()
                    entry["response"] = response_meta
                job.attempt_history_json = json.dumps(current[-300:], ensure_ascii=False)
                generated=[x for x in generated if x.get("slot") != item["slot"]]
                generated.append({"slot":item["slot"],"title":item["title"],"url":url,"selected":True})
                generated_this_run += 1
            except Exception as exc:
                # A failed slot must not discard already generated images or
                # prevent later slots from being attempted.
                current = _history(job); entry = _attempt_entry(current, run_id, item["slot"])
                if entry:
                    entry["state"] = "failed"
                    entry["completed_at"] = _timestamp()
                    entry["error"] = str(exc)[:1400]
                job.attempt_history_json = json.dumps(current[-300:], ensure_ascii=False)
                failures.append({"slot": item["slot"], "title": item["title"], "error": str(exc)[:1400]})
            job.generated_images_json=json.dumps(generated,ensure_ascii=False); job.attempt_history_json=json.dumps(_history(job)[-300:],ensure_ascii=False); db.commit()
        job.selected_images_json=json.dumps([x["url"] for x in generated],ensure_ascii=False)
        job.error_message = json.dumps({"failed_slots": failures}, ensure_ascii=False) if failures else None
        job.status = "ready" if generated else "failed"
        _update_run(db, job, run_id, "ready" if generated else "failed", completed_at=_timestamp(), failed_slots=failures, generated_count=generated_this_run, available_generated_count=len(generated))
        db.commit(); db.refresh(job); return job
    except Exception as exc:
        job.status="failed"; job.error_message=str(exc)[:2000]
        _update_run(db, job, run_id, "failed", completed_at=_timestamp(), error=str(exc)[:1400])
        db.commit(); raise


def queue_set(db: Session, shop_id: int, source_id: int, draft_id: int | None = None, requested_slots: list[str] | None = None, creative_group_key: str = PRODUCT_GROUP_KEY):
    """Create/reset a visible job before handing paid work to a background worker."""
    source_bundle(db, shop_id, source_id, creative_group_key)
    job = db.scalar(select(VisualImageJobRecord).where(
        VisualImageJobRecord.shop_id == shop_id,
        VisualImageJobRecord.source_product_id == source_id,
        VisualImageJobRecord.creative_group_key == creative_group_key,
    ))
    if job and job.status in {"queued", "analyzing", "generating"}:
        updated = job.updated_at
        if updated and updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        if updated and (datetime.now(timezone.utc) - updated).total_seconds() < 900:
            return job, False
    if not job:
        job = VisualImageJobRecord(shop_id=shop_id, source_product_id=source_id, creative_group_key=creative_group_key)
        db.add(job)
    job.listing_draft_id = draft_id or job.listing_draft_id
    job.status = "queued"
    job.error_message = None
    # Preserve earlier successful slots while the new, independent run is in
    # progress. They remain selectable if analysis or generation later fails.
    existing_generated = loads(job.generated_images_json, [])
    if not isinstance(existing_generated, list):
        existing_generated = []
    job.generated_images_json = json.dumps(existing_generated, ensure_ascii=False)
    existing_urls = [item.get("url") for item in existing_generated if item.get("url")]
    job.selected_images_json = json.dumps(existing_urls, ensure_ascii=False)
    db.commit()
    _new_run(db, job, requested_slots)
    db.refresh(job)
    return job, True


def run_queued_set(shop_id: int, source_id: int, draft_id: int | None = None, requested_slots: list[str] | None = None, creative_group_key: str = PRODUCT_GROUP_KEY) -> None:
    """BackgroundTasks entry point; owns its database session."""
    with SessionLocal() as db:
        try:
            generate_set(db, shop_id, source_id, draft_id, requested_slots, creative_group_key)
        except Exception:
            # generate_set persists the failure details for polling clients.
            return


def apply_set(db: Session, job: VisualImageJobRecord, draft: ListingDraftRecord, urls: list[str], actor: str, variant_skus: list[str] | None = None):
    generated=loads(job.generated_images_json,[])
    generated_urls={x.get("url") for x in generated if x.get("url")}
    unknown=[u for u in urls if u not in generated_urls]
    if unknown: raise ValueError("所选图片不属于当前AI任务")
    selected=list(dict.fromkeys(urls))
    if not selected: raise ValueError("至少选择一张AI图片")
    # The operator's selected order is authoritative.  A partial run may not
    # have produced the planned hero slot; its first selected image becomes the
    # SKU primary image so the usable results are not discarded.
    wanted={str(sku).strip() for sku in (variant_skus or []) if str(sku).strip()}
    targets=[variant for variant in draft.variants if variant.seller_sku in wanted] if wanted else list(draft.variants)
    if not targets: raise ValueError("没有找到要应用该款式套图的 SKU")
    before={"public_images":draft.images,"variant_images":{v.seller_sku:v.image_url for v in draft.variants},"variant_image_sets":{v.seller_sku:v.image_urls for v in draft.variants},"target_skus":[v.seller_sku for v in targets]}; hero=selected[0]
    # Never add a style's generated images to the public product gallery.  The
    # selected eight images belong only to the SKUs of this creative group.
    for variant in targets:
        prior=variant.image_urls if variant.image_urls is not None else ([variant.image_url] if variant.image_url else [])
        variant.image_urls=[*selected,*[url for url in prior if url not in selected]][:15]
        variant.image_url=hero
    job.listing_draft_id=draft.id; job.selected_images_json=json.dumps(selected,ensure_ascii=False); job.status="applied"; job.applied_by=actor; job.applied_at=datetime.now(timezone.utc)
    evidence={"analysis":loads(job.analysis_json,{}),"plan":loads(job.plan_json,[]),"references":loads(job.reference_images_json,[]),"generated":loads(job.generated_images_json,[]),"llm_model":job.llm_model,"image_model":job.image_model,"usage":loads(job.usage_json,{})}
    db.add(AuditEventRecord(shop_id=job.shop_id,actor_id=actor,action="ai_visual_style_set_applied",entity_type="listing_draft",entity_id=str(draft.id),details_json=json.dumps({"job_id":job.id,"creative_group_key":job.creative_group_key,"before":before,"after":{"public_images":draft.images,"target_skus":[v.seller_sku for v in targets],"sku_primary":hero},"generation_evidence":evidence},ensure_ascii=False)))
    db.commit(); db.refresh(job); return job
