@echo off
cd /d "%~dp0"
echo AutoLab SCADA - public demo preview only: http://127.0.0.1:8765
python -m http.server 8765 --bind 127.0.0.1
pause
