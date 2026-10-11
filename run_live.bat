@echo off
cd /d "%~dp0"
echo AutoLab SCADA - Local Hardware Mode
where python >nul 2>&1
if errorlevel 1 (
  echo Python not found. Install Python and add it to PATH.
  pause
  exit /b 1
)
echo.
echo IMPORTANT: close Arduino IDE Serial Monitor and serial_test.py.
echo Starting local bridge at http://127.0.0.1:8000/
echo Press Ctrl+C to stop the backend. Keep physical power isolation accessible.
echo.
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 (
  echo.
  echo Check requirements: python -m pip install -r backend\requirements.txt
  pause
)
