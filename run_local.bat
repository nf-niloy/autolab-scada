@echo off
cd /d "%~dp0"
echo.
echo AutoLab SCADA demo server
 echo Open http://localhost:8000 in your browser.
echo Press CTRL+C here to stop the server.
echo.
py -m http.server 8000
if errorlevel 1 python -m http.server 8000
