"""P2: Product fact extraction.

Extracts structured facts (core product, usage, material, form, keywords) from
raw 1688 product data using rule-based heuristics.  Designed to be replaced or
augmented by an AI call without changing the output contract.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..erp_models import SourceProductRecord


@dataclass
class ProductFacts:
    """Structured facts extracted from a source product."""

    core_product: str = ""
    model: str = ""
    usage: str = ""
    material: str = ""
    product_type: str = ""
    form: str = ""
    keywords: list[str] = field(default_factory=list)
    confidence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "core_product": self.core_product,
            "model": self.model,
            "usage": self.usage,
            "material": self.material,
            "product_type": self.product_type,
            "form": self.form,
            "keywords": self.keywords,
            "confidence": self.confidence,
        }


# Rule-based extraction patterns
_MATERIAL_PATTERNS = [
    (re.compile(r"(?: 材质 |material)[:\s]*([^\s,，。]+)", re.IGNORECASE), None),
    (re.compile(r"(不锈钢|塑料|硅胶|陶瓷|玻璃|木质|竹制|棉|涤纶|尼龙|铝合金|铸铁|不锈钢304|ABS)"), None),
]
_USAGE_PATTERNS = [
    (re.compile(r"(?:用途|适用场景|use)[:\s]*([^\s,，。]+)", re.IGNORECASE), None),
    (re.compile(r"(厨房|卫浴|客厅|卧室|办公|户外|车载|婴儿|宠物)"), None),
]
# Model number pattern: uppercase letters + digits (e.g. P3965ANC, TWS-8, X10)
_MODEL_PATTERN = re.compile(r"([A-Z]{1,4}[-]?\d{2,8}[A-Z]{0,4})")

_FORM_PATTERNS = [
    (re.compile(r"(?:形态|形状|form)[:\s]*([^\s,，。]+)", re.IGNORECASE), None),
    (re.compile(r"(圆形|方形|长方形|折叠|伸缩|壁挂|立式|手持)"), None),
]

# Common 1688 title stopwords (Chinese)
_TITLE_STOPWORDS = re.compile(r"(厂家直销|批发|定制|现货|热销|新品|同款|代发|一件代发|工厂|源头|义乌|广州|深圳|淘宝同款|拼多多同款)")


def extract_facts(source: SourceProductRecord) -> ProductFacts:
    """Extract structured facts from a source product record."""
    title = source.title or ""
    # Clean the title for keyword extraction
    clean_title = _TITLE_STOPWORDS.sub("", title)
    # Extract material
    material = source.material or ""
    if not material:
        for pattern, _ in _MATERIAL_PATTERNS:
            match = pattern.search(title)
            if match:
                material = match.group(1) if match.groups() else match.group(0)
                break
    # Extract model number from title
    model = ""
    model_match = _MODEL_PATTERN.search(title)
    if model_match:
        model = model_match.group(1)

    # Extract usage
    usage = ""
    for pattern, _ in _USAGE_PATTERNS:
        match = pattern.search(title)
        if match:
            usage = match.group(1) if match.groups() else match.group(0)
            break
    # Extract form
    form = ""
    for pattern, _ in _FORM_PATTERNS:
        match = pattern.search(title)
        if match:
            form = match.group(1) if match.groups() else match.group(0)
            break
    # Core product: the main noun phrase (simplified heuristic)
    # Remove descriptors and keep the last significant segment
    segments = re.split(r"[\s/、，,]+", clean_title)
    core_product = segments[-1].strip() if segments else clean_title.strip()
    # Keywords: all non-stopword segments
    keywords = [s.strip() for s in segments if s.strip() and len(s.strip()) >= 2]
    # Extract product type from title (search common product type keywords)
    product_type = ""
    _PRODUCT_TYPE_KEYWORDS = (
        "耳机", "音箱", "手表", "手机", "平板", "键盘", "鼠标", "摄像头",
        "充电器", "数据线", "支架", "保护壳", "贴膜", "手环", "眼镜",
        "灯具", "风扇", "插座", "工具", "玩具", "服装", "鞋子", "包包",
        "帽子", "围巾", "手套", "袜子", "杯子", "餐具", "厨具", "收纳",
        "装饰", "文具", "运动", "户外", "车载", "宠物", "美妆", "护肤",
        "洗发", "沐浴",
    )
    for kw in _PRODUCT_TYPE_KEYWORDS:
        if kw in title:
            product_type = kw
            break
    # Confidence: how many facts were extracted
    filled = sum(1 for v in (core_product, model, material, usage, form) if v)
    confidence = min(1.0, filled / 5.0)
    return ProductFacts(
        core_product=core_product,
        model=model,
        product_type=product_type,
        usage=usage,
        material=material,
        form=form,
        keywords=keywords[:20],
        confidence=confidence,
    )
