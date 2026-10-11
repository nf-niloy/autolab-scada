"""One-time private PIN setup. The PIN never enters source files or command history."""
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets

ROOT=Path(__file__).resolve().parent
TARGET=ROOT/'.local'/'credentials.json'


def main():
    print('AutoLab SCADA: configure a fixed operator PIN (not stored in Git).')
    first=getpass.getpass('Enter your six-digit operator PIN: ')
    second=getpass.getpass('Confirm PIN: ')
    if not(first.isascii() and first.isdecimal() and len(first)==6 and first==second):
        raise SystemExit('PIN must be six ASCII digits, and both entries must match.')
    if TARGET.exists():
        confirm=input('A saved PIN already exists. Replace it? Type YES: ')
        if confirm!='YES':
            raise SystemExit('Unchanged.')
    salt=secrets.token_bytes(24)
    rounds=550_000
    digest=hashlib.pbkdf2_hmac('sha256',first.encode('ascii'),salt,rounds)
    TARGET.parent.mkdir(parents=True,exist_ok=True)
    tmp=TARGET.with_suffix('.tmp')
    tmp.write_text(json.dumps({'algorithm':'pbkdf2-sha256','salt':salt.hex(),
                               'iterations':rounds,'hash':digest.hex()}),encoding='utf-8')
    tmp.replace(TARGET)
    try:os.chmod(TARGET,0o600)
    except OSError:pass
    print('Saved hashed PIN locally. It will persist across server restarts.')
    print('Keep this folder private and never commit backend/.local to GitHub.')

if __name__=='__main__':
    main()
