@echo off
rem Creates the daily forecast tasks: 15:00 (ECMWF 00 UTC run), 03:00 (12 UTC run) and a catch-up at logon, Pakistan time.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0schedule_task.ps1"
echo.
echo Tasks created. To run them when nobody is logged in: Task Scheduler - task - Properties -
echo "Run whether user is logged on or not".
pause
