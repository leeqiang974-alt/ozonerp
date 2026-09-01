"""Safe helpers for Ozon promotion aggregation and exit operations."""

def is_protected_promotion(action_type: str | None) -> bool:
    return str(action_type or "").strip().upper() in {"CPC", "CPO"}


def product_ids_from_action_page(page: dict) -> list[int]:
    products = (page.get("result") or {}).get("products") or []
    result = []
    for product in products:
        value = product.get("id") or product.get("product_id")
        if value is not None:
            result.append(int(value))
    return result
