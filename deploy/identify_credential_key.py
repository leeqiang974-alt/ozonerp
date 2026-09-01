import sqlite3
import sys
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

db_path = Path(sys.argv[1])
key_paths = [Path(value) for value in sys.argv[2:]]
db = sqlite3.connect(db_path)
rows = [row[0] for row in db.execute("SELECT encrypted_secret_placeholder FROM api_credentials WHERE encrypted_secret_placeholder IS NOT NULL")]
for key_path in key_paths:
    try:
        key = key_path.read_bytes().strip()
        fernet = Fernet(key)
        if all(fernet.decrypt(value.encode("ascii")) for value in rows):
            print(key_path)
            break
    except (OSError, ValueError, InvalidToken):
        pass
else:
    raise SystemExit("no supplied key decrypts all saved credentials")
