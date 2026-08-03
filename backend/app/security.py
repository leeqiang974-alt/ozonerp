"""Encryption boundary for credentials persisted by the local ERP."""

from os import getenv
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken


class CredentialEncryptionUnavailable(RuntimeError):
    pass


def _fernet() -> Fernet:
    raw_key = getenv("ERP_CREDENTIAL_ENCRYPTION_KEY")
    if not raw_key or raw_key == "replace-with-a-fernet-key":
        raw_key = _development_key()
    try:
        return Fernet(raw_key.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise CredentialEncryptionUnavailable("ERP_CREDENTIAL_ENCRYPTION_KEY is invalid") from exc


def _development_key() -> str:
    """Create a local-only key for the desktop development experience.

    Production must provide an environment variable; silently generating a
    recoverable key there would make a deployment unsafe and non-portable.
    """
    if getenv("APP_ENV", "development").lower() != "development":
        raise CredentialEncryptionUnavailable("ERP_CREDENTIAL_ENCRYPTION_KEY is not configured")
    path = Path(getenv("ERP_LOCAL_SECRET_KEY_PATH", ".local-secrets/credential-fernet.key"))
    try:
        if path.exists():
            return path.read_text(encoding="ascii").strip()
        path.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key().decode("ascii")
        path.write_text(key, encoding="ascii")
        return key
    except OSError as exc:
        raise CredentialEncryptionUnavailable("无法创建本地加密密钥") from exc


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialEncryptionUnavailable("Stored credential cannot be decrypted") from exc
