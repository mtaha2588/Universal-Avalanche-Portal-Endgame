@echo off
setlocal
cd /d "%~dp0"
rem the forecast's own environment (install.bat) first, then any python on PATH
set PY="%~dp0.venv\Scripts\python.exe"
if not exist %PY% (
  set PY=python
  where python >nul 2>nul || set PY=py
)
%PY% run_forecast.py "%~dp0." %*
