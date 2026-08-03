from cryptography.fernet import Fernet

from app.security import decrypt_secret, encrypt_secret


def test_api_key_is_encrypted_at_rest(monkeypatch) -> None:
    monkeypatch.setenv("ERP_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    encrypted = encrypt_secret("test-api-key-not-plain")
    assert encrypted != "test-api-key-not-plain"
    assert decrypt_secret(encrypted) == "test-api-key-not-plain"


def test_development_creates_a_local_key(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("ERP_CREDENTIAL_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    key_path = tmp_path / "credential-fernet.key"
    monkeypatch.setenv("ERP_LOCAL_SECRET_KEY_PATH", str(key_path))
    encrypted = encrypt_secret("local-test-api-key")
    assert key_path.exists()
    assert decrypt_secret(encrypted) == "local-test-api-key"
