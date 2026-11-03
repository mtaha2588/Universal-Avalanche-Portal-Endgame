@echo off
cd /d "%~dp0"
set PY=python
where python >nul 2>nul || set PY=py
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
".venv\Scripts\python.exe" -m pip install -r requirements.txt
echo.
echo Installation finished. Next: run_forecast.bat --check, then schedule_task.bat
pause
