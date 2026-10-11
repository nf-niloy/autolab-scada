"""Configure a public Tailscale Funnel URL without embedding secrets in public JS."""
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

BASE=Path(__file__).resolve().parent
ROOT=BASE.parent


def main():
    if len(sys.argv)!=2:
        raise SystemExit('Usage: python backend/configure_remote.py https://YOUR-DEVICE.TAILNET.ts.net')
    url=sys.argv[1].strip().rstrip('/')
    info=urlsplit(url)
    if info.scheme!='https' or not info.hostname or not info.hostname.endswith('.ts.net') or info.port or info.username or info.password or info.path or info.query or info.fragment:
        raise SystemExit('Only a HTTPS Tailscale Funnel address ending in .ts.net is accepted.')
    (BASE/'.local').mkdir(parents=True,exist_ok=True)
    (BASE/'.local'/'remote.json').write_text(json.dumps({'url':url}),encoding='utf-8')
    (ROOT/'src'/'remote-config.js').write_text('// Public tunnel address (NOT a secret). Never store PINs or tokens here.\nexport const REMOTE_API_URL = '+json.dumps(url)+';\n',encoding='utf-8')
    print('Public API URL configured. Restart backend before connecting Funnel.')
    print('After local verification, commit src/remote-config.js; never commit backend/.local.')

if __name__=='__main__':
    main()
