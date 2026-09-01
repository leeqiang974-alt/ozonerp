from pathlib import Path

env_path = Path('/srv/ozon-erp/.env')
key = Path('/srv/ozon-erp/migration/local-credential-fernet.key').read_text(encoding='ascii').strip()
lines = env_path.read_text(encoding='utf-8').splitlines()
out = [f'ERP_CREDENTIAL_ENCRYPTION_KEY={key}' if line.startswith('ERP_CREDENTIAL_ENCRYPTION_KEY=') else line for line in lines]
env_path.write_text('\n'.join(out) + '\n', encoding='utf-8')
env_path.chmod(0o600)
print('production credential key aligned with migrated credentials')
