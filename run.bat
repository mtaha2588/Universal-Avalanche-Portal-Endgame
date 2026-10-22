@echo off
title Pakistan Avalanche Intelligence Portal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python is not installed on this computer.
  echo Install Python 3.10 or newer from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup, then run this file again.
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
rem Reinstall packages only when requirements.txt has changed since the last install.
fc /b requirements.txt .venv\requirements.installed >nul 2>&1
if errorlevel 1 (
  echo Installing dependencies...
  pip install -q -r requirements.txt && copy /y requirements.txt .venv\requirements.installed >nul
)

echo Starting portal server...
start "Avalanche Portal Server" /min python app.py

rem Wait until the server answers before opening the browser.
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
curl -s -o nul http://127.0.0.1:5000/api/config && goto ready
if %tries% lss 30 goto wait
echo The server did not start. Check the "Avalanche Portal Server" window for errors.
pause
exit /b 1

:ready
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome
echo Google Chrome was not found - opening the default browser instead.
start "" http://127.0.0.1:5000/
goto running

:chrome
start "" "%CHROME%" --new-window --start-fullscreen http://127.0.0.1:5000/

:running
echo.
echo  Portal is running at http://127.0.0.1:5000/
echo  (Press F11 in Chrome to leave full screen.)
echo.
echo  Press any key here to STOP the portal.
pause >nul
taskkill /fi "WINDOWTITLE eq Avalanche Portal Server*" /t /f >nul 2>&1
