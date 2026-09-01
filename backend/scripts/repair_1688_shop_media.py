"""Repair legacy 1688 shop media without reopening product detail pages.

Reads the persisted itemcdn detail endpoint, removes globally repeated page UI
assets, and rebuilds each source gallery from retained product/SKU media plus
the authoritative detail images. Failed detail requests leave a product intact.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import re
import sqlite3
import time
import urllib.request
from collections import Counter
from pathlib import Path


DETAIL_RE = re.compile(r"(?:src|data-src|data-lazyload-src|background)=[\"'](https?://[^\"']+)[\"']", re.I)


def fetch_detail(url: str, timeout: int = 20) -> list[str]:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 OzonERP-MediaRepair/1.0"})
    raw = urllib.request.urlopen(request, timeout=timeout).read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        # Older 1688 detail fragments from this shop are still GBK encoded.
        text = raw.decode("gb18030")
    if re.match(r"^\s*var\s+offer_details\s*=", text):
        json_text = re.sub(r"^\s*var\s+offer_details\s*=\s*", "", text)
        payload = json.loads(re.sub(r";\s*$", "", json_text))
        content = str(payload.get("content") or "")
    elif re.match(r"^\s*var\s+desc\s*=", text):
        # Legacy 1688 descriptions are JavaScript string assignments rather
        # than JSON. Remove shop-tool related-product blocks before extracting
        # product detail media.
        content = text.replace("\\/", "/")
        content = re.sub(
            r'<div[^>]+title=["\']SHOPTOOL_[^"\']+_BEGIN["\'][^>]*>.*?'
            r'<div[^>]+title=["\']SHOPTOOL_[^"\']+_END["\'][^>]*>.*?</div>',
            "", content, flags=re.I | re.S,
        )
    else:
        raise ValueError("详情接口返回未知格式")
    found: list[str] = []
    for value in DETAIL_RE.findall(content):
        value = html.unescape(value.replace("\\/", "/"))
        if value not in found:
            found.append(value)
    return found


def is_ui_asset(url: str, frequency: int, protected: set[str]) -> bool:
    if url in protected:
        return False
    lowered = url.lower()
    if lowered.endswith("/2020/428/378/22185873824_536529798.jpg"):
        return True
    if "/tfs/" in lowered or "gw.alicdn.com/tfs/" in lowered:
        return True
    # An identical image across hundreds of unrelated offers is page chrome,
    # a generic placeholder, or a shared video poster rather than product media.
    return frequency >= 100


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(Path(__file__).resolve().parents[1] / "ozon_erp.db"))
    parser.add_argument("--shop-key", required=True)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--include-repaired", action="store_true")
    args = parser.parse_args()

    db = sqlite3.connect(args.db, timeout=30)
    db.row_factory = sqlite3.Row
    status_filter = "" if args.include_repaired else " and ingestion_status != 'media_repaired'"
    products = db.execute(
        f"select id, source_product_id, raw_json from source_products where source_shop_key=?{status_filter} order by id",
        (args.shop_key,),
    ).fetchall()
    if args.limit:
        products = products[: args.limit]
    product_ids = [int(row["id"]) for row in products]
    if not product_ids:
        print(json.dumps({"total": 0, "repaired": 0, "failed": 0}))
        return 0

    placeholders = ",".join("?" for _ in product_ids)
    frequencies = Counter(
        row["url"]
        for row in db.execute(
            f"select url from source_media where media_type='image' and source_product_id in ({placeholders})",
            product_ids,
        )
    )

    jobs: list[tuple[sqlite3.Row, dict, str]] = []
    skipped = 0
    for row in products:
        snapshot = json.loads(row["raw_json"] or "{}")
        detail_url = str(snapshot.get("source_description") or "").strip()
        if not detail_url:
            skipped += 1
            continue
        jobs.append((row, snapshot, detail_url))

    started = time.time()
    repaired = failed = removed = added = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as pool:
        future_map = {pool.submit(fetch_detail, detail_url): (row, snapshot) for row, snapshot, detail_url in jobs}
        for future in concurrent.futures.as_completed(future_map):
            row, snapshot = future_map[future]
            try:
                detail_images = future.result()
                existing = db.execute(
                    "select id, media_type, url, sort_order, is_primary from source_media where source_product_id=? order by sort_order, id",
                    (row["id"],),
                ).fetchall()
                protected = {str(v.get("image_url") or "") for v in snapshot.get("variants", []) if v.get("image_url")}
                retained: list[str] = []
                for media in existing:
                    url = str(media["url"] or "")
                    if media["media_type"] != "image" or is_ui_asset(url, frequencies[url], protected):
                        continue
                    if url and url not in retained:
                        retained.append(url)
                rebuilt: list[str] = []
                for url in retained + list(protected) + detail_images:
                    if url and url not in rebuilt:
                        rebuilt.append(url)
                if not rebuilt:
                    raise ValueError("修复结果没有有效商品图片")
                old_image_count = sum(1 for item in existing if item["media_type"] == "image")
                videos = [item for item in existing if item["media_type"] != "image"]
                db.execute("delete from source_media where source_product_id=?", (row["id"],))
                for index, url in enumerate(rebuilt):
                    db.execute(
                        "insert into source_media(source_product_id,media_type,url,sort_order,is_primary) values(?,?,?,?,?)",
                        (row["id"], "image", url, index, 1 if index == 0 else 0),
                    )
                for offset, media in enumerate(videos, start=len(rebuilt)):
                    db.execute(
                        "insert into source_media(source_product_id,media_type,url,sort_order,is_primary) values(?,?,?,?,0)",
                        (row["id"], media["media_type"], media["url"], offset),
                    )
                snapshot["media"] = [
                    {"url": url, "media_type": "image", "sort_order": index, "is_primary": index == 0}
                    for index, url in enumerate(rebuilt)
                ]
                snapshot["media_complete"] = True
                snapshot["main_image_url"] = rebuilt[0]
                db.execute(
                    "update source_products set raw_json=?, main_image_url=?, ingestion_status='media_repaired' where id=?",
                    (json.dumps(snapshot, ensure_ascii=False), rebuilt[0], row["id"]),
                )
                db.commit()
                repaired += 1
                removed += max(0, old_image_count - len(retained))
                added += sum(1 for url in detail_images if url not in retained)
            except Exception as exc:
                db.rollback()
                failed += 1
                print(json.dumps({"offer_id": row["source_product_id"], "status": "failed", "error": str(exc)[:300]}, ensure_ascii=False), flush=True)
            if (repaired + failed) % 100 == 0:
                print(json.dumps({"processed": repaired + failed, "repaired": repaired, "failed": failed}, ensure_ascii=False), flush=True)
    result = {
        "total": len(products), "repaired": repaired, "failed": failed, "skipped": skipped,
        "removed_legacy_images": removed, "added_detail_images": added,
        "elapsed_seconds": round(time.time() - started, 1),
    }
    print(json.dumps(result, ensure_ascii=False), flush=True)
    db.close()
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
