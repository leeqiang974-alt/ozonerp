import json
import os
import sys


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"available": False, "error": "missing image path"}))
        return
    image_path = sys.argv[1]
    try:
        import easyocr
    except Exception as exc:
        print(json.dumps({"available": False, "error": f"easyocr unavailable: {exc}"}))
        return

    model_dir = os.environ.get("EASYOCR_MODEL_DIR") or r"D:\OzonERP\easyocr-models"
    os.makedirs(model_dir, exist_ok=True)
    texts = []
    seen = set()
    for langs in (["ch_sim", "en"], ["ru", "en"]):
        reader = easyocr.Reader(langs, gpu=False, verbose=False, model_storage_directory=model_dir)
        rows = reader.readtext(image_path)
        for row in rows:
            try:
                _bbox, text, confidence = row
            except ValueError:
                continue
            clean_text = str(text).strip()
            if float(confidence or 0) >= 0.45 and clean_text:
                key = clean_text.casefold()
                if key in seen:
                    continue
                seen.add(key)
                texts.append({"text": clean_text, "confidence": float(confidence or 0), "langs": langs})
    print(json.dumps({"available": True, "texts": texts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
