"""P2: Category matching.

Recalls Top-20 Ozon categories from the global cache and re-ranks to Top-5
using rule-based scoring against extracted product facts.  The operator
confirms the final choice; nothing is written to Ozon.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..erp_models import OzonGlobalCategoryCacheRecord, PipelineProductRecord, SourceProductRecord
from ..listing_cache_service import promote_legacy_listing_caches
from .fact_extraction import ProductFacts, extract_facts


@dataclass
class CategoryCandidate:
    category_id: str
    type_id: str
    title: str
    score: float
    matched_keywords: list[str]
    title_zh: str | None = None


def recall_categories(db: Session, shop_id: int, facts: ProductFacts, limit: int = 20) -> list[CategoryCandidate]:
    """Search the global Ozon category cache and return up to *limit* matches.

    Searches both the Russian title and the Chinese title_zh so that Chinese
    product keywords can match Chinese category names directly.
    """
    promote_legacy_listing_caches(db)
    keywords = facts.keywords or [facts.core_product]
    # Build search terms: full keywords + 2-char segments for Chinese text
    search_terms: list[str] = []
    for keyword in keywords:
        if not keyword or len(keyword) < 2:
            continue
        search_terms.append(keyword[:100])
        for i in range(len(keyword) - 1):
            seg = keyword[i:i+2]
            if seg not in search_terms:
                search_terms.append(seg)
    seen_ids: set[tuple[str, str]] = set()
    candidates: list[CategoryCandidate] = []
    for term in search_terms:
        if len(term) < 2:
            continue
        rows = db.scalars(select(OzonGlobalCategoryCacheRecord).where(
            OzonGlobalCategoryCacheRecord.type_id != "",
            or_(
                OzonGlobalCategoryCacheRecord.title.ilike(f"%{term}%"),
                OzonGlobalCategoryCacheRecord.title_zh.ilike(f"%{term}%"),
            ),
        ).limit(limit)).all()
        for row in rows:
            key = (row.category_id, row.type_id)
            if key in seen_ids:
                continue
            seen_ids.add(key)
            candidates.append(CategoryCandidate(
                category_id=row.category_id,
                type_id=row.type_id,
                title=row.title,
                score=0.0,
                matched_keywords=[term],
                title_zh=row.title_zh,
            ))
    return candidates


# Product type -> domain keywords that indicate a CORRECT parent category
PRODUCT_TYPE_DOMAIN_MAP: dict[str, list[str]] = {
    "耳机": ["电子", "数码", "音频", "消费电子", "electronics", "audio"],
    "音箱": ["电子", "数码", "音频", "消费电子", "electronics", "audio"],
    "手机": ["电子", "数码", "通讯", "消费电子", "electronics"],
    "手机壳": ["电子", "数码", "通讯", "配件", "electronics"],
    "充电器": ["电子", "数码", "消费电子", "electronics"],
    "数据线": ["电子", "数码", "消费电子", "electronics"],
    "手表": ["电子", "数码", "钟表", "配饰", "watches"],
    "支架": ["电子", "数码", "配件", "办公", "electronics"],
    "灯具": ["照明", "家居", "lighting"],
    "玩具": ["玩具", "儿童", "toys"],
    "杯子": ["家居", "厨具", "餐饮", "home"],
    "厨具": ["厨房", "家居", "厨具", "kitchen"],
    "收纳": ["家居", "收纳", "整理", "home", "storage"],
    "服装": ["服装", "服饰", "clothing"],
    "鞋子": ["鞋靴", " footwear"],
    "包包": ["箱包", "配饰", "bags"],
}

# Keywords that indicate a WRONG domain when in parent category for given product type
WRONG_DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "耳机": ["消防", "防护", "工业", "建筑", "医疗", "美容", "汽配", "五金", "安防"],
    "音箱": ["消防", "防护", "工业", "建筑", "医疗", "美容", "汽配", "五金", "安防"],
    "手机": ["消防", "防护", "工业", "建筑", "医疗", "美容", "汽配", "五金", "安防"],
    "充电器": ["消防", "防护", "工业", "建筑", "医疗", "美容", "汽配", "五金", "安防"],
    "数据线": ["消防", "防护", "工业", "建筑", "医疗", "美容", "汽配", "五金", "安防"],
}


def _check_domain_compatibility(product_type: str, parent_name: str) -> float:
    """Return a penalty multiplier (0.0 = fully excluded, 1.0 = no penalty).

    Checks if the parent category name contains keywords that are incompatible
    with the product type.
    """
    if not product_type or not parent_name:
        return 1.0
    parent_lower = parent_name.lower()
    # Check exclusion keywords
    exclusions = WRONG_DOMAIN_KEYWORDS.get(product_type, [])
    for ex in exclusions:
        if ex.lower() in parent_lower:
            return 0.05  # nearly excluded - keep a tiny score so it still appears as a candidate
    # Check domain match - boost if parent contains expected domain keyword
    domains = PRODUCT_TYPE_DOMAIN_MAP.get(product_type, [])
    for d in domains:
        if d.lower() in parent_lower:
            return 1.5  # boost
    return 1.0


def rerank_categories(candidates: list[CategoryCandidate], facts: ProductFacts) -> list[CategoryCandidate]:
    """Score and sort candidates by keyword overlap with product facts.

    Uses title_zh (Chinese) when available so that Chinese product keywords
    match Chinese category names.  Falls back to the Russian title otherwise.
    Applies domain compatibility penalties to prevent gross mismatches
    (e.g., headphones matching to fire-protection equipment).
    """
    # Build fact words: full keywords + 2-char segments for Chinese matching
    fact_words = set()
    for field_name in ("core_product", "usage", "material", "form"):
        value = getattr(facts, field_name, "")
        if value:
            vl = value.lower()
            fact_words.update(vl.split())
            for i in range(len(vl) - 1):
                fact_words.add(vl[i:i+2])
    fact_words.update(kw.lower() for kw in facts.keywords)
    for kw in facts.keywords:
        kl = kw.lower()
        for i in range(len(kl) - 1):
            fact_words.add(kl[i:i+2])

    # Count 2-char segment frequency in product title to identify core keywords
    core_text = (facts.core_product or "").lower()
    seg_freq: dict[str, int] = {}
    for i in range(len(core_text) - 1):
        seg = core_text[i:i+2]
        seg_freq[seg] = seg_freq.get(seg, 0) + 1

    product_type = facts.product_type or ""

    for candidate in candidates:
        match_title = candidate.title_zh or candidate.title
        tl = match_title.lower()
        # Split into parent and type name (last segment after /)
        parts = tl.split('/')
        type_name = parts[-1].strip() if parts else tl
        parent_name = '/'.join(parts[:-1]).strip() if len(parts) > 1 else ''
        title_words = set(tl.split())
        for i in range(len(tl) - 1):
            title_words.add(tl[i:i+2])
        overlap = fact_words & title_words
        # Base score: 10 per matching segment, weighted by frequency in product title
        score = 0.0
        for word in overlap:
            freq = seg_freq.get(word, 1)
            score += 10.0 * freq
        # Big bonus: type name (leaf category) contains a frequent keyword
        type_words = set()
        for i in range(len(type_name) - 1):
            type_words.add(type_name[i:i+2])
        type_words.update(type_name.split())
        type_overlap = fact_words & type_words
        for word in type_overlap:
            freq = seg_freq.get(word, 1)
            score += 30.0 * freq
        # Parent category overlap (new): reward parent category keyword matches
        parent_words = set()
        for i in range(len(parent_name) - 1):
            parent_words.add(parent_name[i:i+2])
        parent_words.update(parent_name.split())
        parent_overlap = fact_words & parent_words
        for word in parent_overlap:
            freq = seg_freq.get(word, 1)
            score += 15.0 * freq
        # Domain compatibility penalty (new): prevent gross category mismatches
        domain_mult = _check_domain_compatibility(product_type, parent_name)
        score *= domain_mult
        candidate.score = round(score, 2)
        candidate.matched_keywords = list(overlap | type_overlap | parent_overlap)
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[:5]


def match_categories(db: Session, shop_id: int, source_product_id: int) -> tuple[ProductFacts, list[CategoryCandidate]]:
    """Full P2 flow: extract facts, recall, and rerank categories."""
    source_product = db.scalar(select(SourceProductRecord).where(SourceProductRecord.id == source_product_id))
    if source_product is None:
        raise ValueError('source product not found')
    facts = extract_facts(source_product)
    candidates = recall_categories(db, shop_id, facts)
    candidates = rerank_categories(candidates, facts)
    # Persist to pipeline product
    pipeline = _ensure_pipeline_product(db, shop_id, source_product_id)
    if candidates:
        pipeline.matched_category_id = candidates[0].category_id
        pipeline.matched_type_id = candidates[0].type_id
        pipeline.category_confidence = Decimal(str(candidates[0].score)) if candidates[0].score else None
    pipeline.category_candidates_json = json.dumps(
        [asdict(c) for c in candidates], ensure_ascii=False
    )
    pipeline.pipeline_stage = "category_matched"
    db.commit()
    return facts, candidates


def lock_category(db: Session, shop_id: int, source_product_id: int, category_id: str, type_id: str) -> PipelineProductRecord:
    """Operator confirms the final category choice."""
    pipeline = _ensure_pipeline_product(db, shop_id, source_product_id)
    pipeline.matched_category_id = category_id
    pipeline.matched_type_id = type_id
    # A complete category pair explicitly selected by the operator is the
    # strongest possible evidence.  It must not inherit the zero confidence
    # of an earlier AI/category recall attempt.
    pipeline.category_confidence = Decimal("100")
    pipeline.pipeline_stage = "category_locked"
    db.commit()
    db.refresh(pipeline)
    return pipeline


def _ensure_pipeline_product(db: Session, shop_id: int, source_product_id: int) -> PipelineProductRecord:
    record = db.scalar(select(PipelineProductRecord).where(
        PipelineProductRecord.shop_id == shop_id,
        PipelineProductRecord.source_product_id == source_product_id,
    ))
    if record is None:
        record = PipelineProductRecord(shop_id=shop_id, source_product_id=source_product_id)
        db.add(record)
        db.flush()
    return record
