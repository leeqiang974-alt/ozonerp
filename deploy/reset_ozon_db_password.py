import os
import secrets
import subprocess

root = "/srv/ozon-erp"
password = secrets.token_hex(24)
container = "4ef6bee42a18"
subprocess.run(
    ["docker", "exec", container, "psql", "-U", "ozon_erp", "-d", "ozon_erp", "-v", "ON_ERROR_STOP=1", "-c", f"ALTER USER ozon_erp PASSWORD '{password}';"],
    check=True,
    stdout=subprocess.DEVNULL,
)
fernet = subprocess.check_output(["openssl", "rand", "-base64", "32"], text=True).strip().replace("/", "_").replace("+", "-").replace("=", "")
lines = [
    f"POSTGRES_PASSWORD={password}",
    "APP_ENV=production",
    f"DATABASE_URL=postgresql+psycopg://ozon_erp:{password}@127.0.0.1:55432/ozon_erp",
    f"ERP_CREDENTIAL_ENCRYPTION_KEY={fernet}",
    "OZON_API_BASE_URL=https://api-seller.ozon.ru",
    "LLM_PROVIDER=deepseek",
    "GENERATED_IMAGE_PUBLIC_BASE=https://ozon.woxq.cn/generated/ai-images",
    "YUNNIUDUN_REDIRECT_URI=https://ozon.woxq.cn/api/v1/yunniudun/oauth/callback",
]
with open(os.path.join(root, ".env"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
os.chmod(os.path.join(root, ".env"), 0o600)
print("database password reset and environment updated")
