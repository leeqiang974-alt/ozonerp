import json
import os
import subprocess

root = "/srv/ozon-erp"
raw = subprocess.check_output(["docker", "inspect", "4ef6bee42a18"], text=True)
env = json.loads(raw)[0]["Config"]["Env"]
values = {item.split("=", 1)[0]: item.split("=", 1)[1] for item in env if "=" in item}
dbpass = values.get("POSTGRES_PASSWORD", "")
if not dbpass:
    raise SystemExit("database password not found")
fernet = subprocess.check_output(["openssl", "rand", "-base64", "32"], text=True).strip().replace("/", "_").replace("+", "-").replace("=", "")
lines = [
    f"POSTGRES_PASSWORD={dbpass}",
    "APP_ENV=production",
    f"DATABASE_URL=postgresql+psycopg://ozon_erp:{dbpass}@127.0.0.1:55432/ozon_erp",
    f"ERP_CREDENTIAL_ENCRYPTION_KEY={fernet}",
    "OZON_API_BASE_URL=https://api-seller.ozon.ru",
    "LLM_PROVIDER=deepseek",
    "GENERATED_IMAGE_PUBLIC_BASE=https://ozon.woxq.cn/generated/ai-images",
    "YUNNIUDUN_REDIRECT_URI=https://ozon.woxq.cn/api/v1/yunniudun/oauth/callback",
]
path = os.path.join(root, ".env")
with open(path, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
os.chmod(path, 0o600)
print("environment repaired")
