#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
printf 'AutoLab SCADA available at http://localhost:8000\n'
python3 -m http.server 8000
