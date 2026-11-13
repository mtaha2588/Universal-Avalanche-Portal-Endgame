@echo off
rem ---------------------------------------------------------------------------------------------------------------
rem  Start the portal from a terminal (VS Code's terminal, PowerShell or cmd). The server runs IN this terminal:
rem  its log shows here and Ctrl+C stops it.
rem
rem      .\start.cmd          start the server
rem      .\start.cmd open     start the server and open it in Chrome once it answers
rem
rem  Same preparation as run.bat (virtual environment, packages only when requirements.txt changed, .env from
rem  .env.example), without the console prompts. If the portal is already running it says so and does not start twice.
rem ---------------------------------------------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
set "URL=http://127.0.0.1:5000/"

rem (internal) the helper started below: wait until the server answers, then open the browser
if /i "%~1"=="__open" goto open_when_ready

where python >nul 2>&1
if errorlevel 1 (
  echo Python is not installed or not on PATH. Install Python 3.10+ from https://www.python.org/downloads/
  exit /b 1
)

rem already running? (port 5000 listening)
netstat -ano | findstr /r /c:":5000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo The portal is already running at %URL%
  if /i "%~1"=="open" call :browser
  exit /b 0
)

if not exist .venv (
  echo Creating the virtual environment ^(first run only^)...
  python -m venv .venv || exit /b 1
)
call .venv\Scripts\activate.bat
fc /b requirements.txt .venv\requirements.installed >nul 2>&1
if errorlevel 1 (
  echo Installing packages ^(requirements.txt changed^)...
  pip install -q -r requirements.txt && copy /y requirements.txt .venv\requirements.installed >nul
)
if exist .env for %%F in (.env) do if %%~zF==0 del /q .env
if not exist .env if exist .env.example copy /y .env.example .env >nul

if /i "%~1"=="open" start "" /min cmd /c ""%~f0" __open"

echo.
echo  Starting the portal at %URL%   (Ctrl+C stops it)
echo.
python app.py
exit /b %errorlevel%

:open_when_ready
for /l %%i in (1,1,60) do (
  curl -s -o nul %URL%api/config && goto open_now
  timeout /t 1 /nobreak >nul
)
exit /b 1
:open_now
call :browser
exit /b 0

:browser
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (start "" "%CHROME%" --new-window --start-fullscreen %URL%) else (start "" %URL%)
exit /b 0
