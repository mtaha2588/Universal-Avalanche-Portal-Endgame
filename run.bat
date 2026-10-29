@echo off
title Snow Avalanche Prediction Using AI
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
  python -m pip install -q -r requirements.txt && copy /y requirements.txt .venv\requirements.installed >nul
)
python -c "import flask, waitress, dotenv" >nul 2>&1
if errorlevel 1 (
  echo.
  echo  The portal's Python packages could not be installed ^(Flask, Waitress^).
  echo  Check the internet connection, then run this file again. If it still fails, delete the .venv folder
  echo  and run again. Python 3.10 - 3.12 from python.org is recommended.
  python --version
  pause
  exit /b 1
)

rem First run from a GitHub ZIP: .env (Mapbox key) and the local terrain tiles are not in the download.
if exist .env for %%F in (.env) do if %%~zF==0 del /q .env
if not exist .env (
  copy /y .env.example .env >nul
  echo  .env created from .env.example.
)
findstr /b /c:"MAPBOX_TOKEN=pk." .env >nul 2>&1
if errorlevel 1 (
  echo.
  echo  No Mapbox key in .env: the portal uses the basic map and the intro has NO globe.
  echo  For the full 3D globe, put your key in .env as MAPBOX_TOKEN=pk... and run this file again.
  echo.
)
if not exist data\dem\terrarium (
  echo.
  echo  The local terrain tiles are missing ^(about 400 MB^). Without them the 3D terrain loads slowly from the internet.
  choice /c YN /t 15 /d Y /m " Download them now in the background"
  if not errorlevel 2 start "Terrain download" /min python scripts\fetch_dem.py
)

rem A portal server left running from an earlier copy (e.g. an older GitHub download) would keep port 5000, and the
rem browser would open that OLD portal. Stop any Python server listening on 5000 first.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":5000 .*LISTENING"') do (
  tasklist /fi "PID eq %%P" 2>nul | findstr /i "python" >nul && (
    echo  Stopping an earlier portal server ^(PID %%P^) so this copy is served...
    taskkill /pid %%P /t /f >nul 2>&1
  )
)
timeout /t 1 /nobreak >nul

echo Starting portal server...
rem The server's messages go to server.log, so an error can be shown here if it fails to start.
if exist server.log del /q server.log >nul 2>&1
start "Avalanche Portal Server" /min cmd /c "python app.py > server.log 2>&1"

rem Wait until the server answers before opening the browser (curl ships with Windows 10 and 11).
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
curl -s -o nul http://127.0.0.1:5000/api/config && goto ready
findstr /c:"Traceback" server.log >nul 2>&1 && goto failed
if %tries% lss 45 goto wait
:failed
echo.
echo  The portal server did not start. Its messages:
echo  ------------------------------------------------------------
if exist server.log (type server.log) else (echo  ^(no output^))
echo  ------------------------------------------------------------
echo  Send a photo of this window to the portal team.
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
