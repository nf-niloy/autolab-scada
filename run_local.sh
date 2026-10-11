#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
printf 'AutoLab SCADA demo preview: http://127.0.0.1:8765\n'
python3 -m http.server 8765 --bind 127.0.0.1
