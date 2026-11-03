# Registers the daily avalanche alert forecast for the current Windows user.
#  - 15:00 and 03:00 Pakistan time: a fresh 15-day run after each ECMWF cycle (00 / 12 UTC)
#  - at logon: catch-up run, skipped when the last success is younger than 10 h
# Missed start times (PC off or asleep) are run as soon as the PC is available again.
$ErrorActionPreference = "Stop"
$bat = Join-Path $PSScriptRoot "run_forecast.bat"
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
foreach ($t in @(@{ n = "Avalanche Forecast 00z"; at = "15:00" }, @{ n = "Avalanche Forecast 12z"; at = "03:00" })) {
  $act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$bat`"`"" -WorkingDirectory $PSScriptRoot
  Register-ScheduledTask -TaskName $t.n -Action $act -Trigger (New-ScheduledTaskTrigger -Daily -At $t.at) -Settings $set -Force | Out-Null
  Write-Host "registered: $($t.n) daily at $($t.at)"
}
$act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$bat`" --if-stale 10`"" -WorkingDirectory $PSScriptRoot
$trg = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trg.Delay = "PT3M"
Register-ScheduledTask -TaskName "Avalanche Forecast catch-up" -Action $act -Trigger $trg -Settings $set -Force | Out-Null
Write-Host "registered: Avalanche Forecast catch-up (at logon, skipped if a run succeeded in the last 10 h)"
