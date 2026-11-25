# demo_capture.ps1 - screenshots of the REAL running portal for the static interview demo (demo/assets/shots/*.webp)
# =====================================================================================================================
# Start the portal first (start.cmd), then from the project folder:
#     powershell -ExecutionPolicy Bypass -File scripts\demo_capture.ps1            (all shots)
#     powershell -ExecutionPolicy Bypass -File scripts\demo_capture.ps1 -Only alert,models
# Headless Chrome is driven in real time through the DevTools protocol (the maps load network tiles, so a
# --virtual-time-budget screenshot would miss them). Viewport 1600 x 900, WebP quality 82. Nothing is edited:
# every image is the portal as it renders with its own data.
param([string]$Base = "http://127.0.0.1:5000", [string[]]$Only = @(), [int]$W = 1600, [int]$H = 900)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "demo\assets\shots"
New-Item -ItemType Directory -Force $out | Out-Null
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" }
$prof = Join-Path $env:TEMP ("demo-capture-" + (Get-Date -Format "yyyyMMddHHmmss"))
$port = 9341
$p = Start-Process $chrome -ArgumentList "--headless=new", "--remote-debugging-port=$port", "--user-data-dir=$prof", "--window-size=$W,$H",
  "--no-first-run", "--hide-scrollbars", "--mute-audio", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "about:blank" -PassThru
Start-Sleep 3
$tab = (Invoke-RestMethod "http://127.0.0.1:$port/json") | Where-Object { $_.type -eq "page" } | Select-Object -First 1
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$tab.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
$script:id = 0; $script:pending = $null; $script:buf = New-Object byte[] 1048576; $script:ms = New-Object IO.MemoryStream; $script:errs = @()

function Send($method, $params = @{}) {
  $script:id++
  $b = [Text.Encoding]::UTF8.GetBytes((@{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 10 -Compress))
  $ws.SendAsync((New-Object ArraySegment[byte] -ArgumentList @(, $b)), "Text", $true, [Threading.CancellationToken]::None).Wait()
  return $script:id
}
function Drain($seconds, $want = -1) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if (-not $script:pending) { $script:pending = $ws.ReceiveAsync((New-Object ArraySegment[byte] -ArgumentList @(, $script:buf)), [Threading.CancellationToken]::None) }
    if (-not $script:pending.Wait([int][Math]::Max(50, ($until - (Get-Date)).TotalMilliseconds))) { break }
    $r = $script:pending.Result; $script:pending = $null; $script:ms.Write($script:buf, 0, $r.Count)
    if (-not $r.EndOfMessage) { continue }
    $j = [Text.Encoding]::UTF8.GetString($script:ms.ToArray()) | ConvertFrom-Json; $script:ms = New-Object IO.MemoryStream
    if ($j.method -eq "Runtime.exceptionThrown") { $script:errs += $j.params.exceptionDetails.exception.description }
    if ($want -ge 0 -and $j.id -eq $want) { return $j }
  }
}
function Eval($expr, $wait = 6) { $i = Send "Runtime.evaluate" @{ expression = $expr; returnByValue = $true; awaitPromise = $true }; $r = Drain $wait $i; if ($r) { $r.result.result.value } }
function Go($path, $wait) { [void](Send "Page.navigate" @{ url = "about:blank" }); [void](Drain 1); [void](Send "Page.navigate" @{ url = "$Base$path" }); [void](Drain $wait) }
function Shot($name) {
  $i = Send "Page.captureScreenshot" @{ format = "webp"; quality = 82 }; $r = Drain 30 $i
  $f = Join-Path $out "$name.webp"; [IO.File]::WriteAllBytes($f, [Convert]::FromBase64String($r.result.data))
  "{0,-16} {1,6} KB" -f $name, [int]((Get-Item $f).Length / 1KB)
}
$Only = @($Only | ForEach-Object { $_ -split "," } | Where-Object { $_ })   # -File passes "a,b" as one string
$want = { param($n) $Only.Count -eq 0 -or $Only -contains $n }

[void](Send "Runtime.enable"); [void](Send "Page.enable"); [void](Send "Network.enable")
[void](Send "Network.setCacheDisabled" @{ cacheDisabled = $true })
[void](Send "Emulation.setDeviceMetricsOverride" @{ width = $W; height = $H; deviceScaleFactor = 1; mobile = $false })
[void](Drain 1)

# front page (no intro with #home) and the three glacier systems
if ((& $want "home") -or (& $want "systems")) {
  Go "/#home" 18
  if (& $want "home") { Shot "home" }
  if (& $want "systems") {
    foreach ($s in @(@("Hindu Kush", "sys_hk"), @("Karakoram", "sys_kk"), @("West Himalaya", "sys_wh"))) { [void](Eval "bgMap.focus('$($s[0])'); 1" 2); [void](Drain 9); Shot $s[1] }
  }
}
if (& $want "pakistan") {
  Go "/#home" 16
  [void](Eval "document.querySelector('#gchips .gchip.pak, #xchips .gchip.pak').click(); 1" 2); [void](Drain 9); Shot "pakistan"
  [void](Eval "document.querySelector('#gchips .gchip.all, #xchips .gchip.all').click(); 1" 2); [void](Drain 9); Shot "overview3"
}
if (& $want "intro") { Go "/" 4; Shot "intro_a"; [void](Drain 7); Shot "intro_b"; [void](Drain 8); Shot "intro_c" }
if (& $want "alert") { Go "/#alertforecast" 22; Shot "alert" }
if (& $want "climate") { Go "/#climate" 16; Shot "climate_hist"; [void](Eval "document.querySelector('[data-view=proj]').click(); 1" 2); [void](Drain 14); Shot "climate_proj" }
if (& $want "history") { Go "/#history" 9; Shot "history"; [void](Eval "HistTour.open({ tour: true }); 1" 3); [void](Drain 34); Shot "tour_a"; [void](Drain 12); Shot "tour_b" }
if (& $want "reports") { Go "/#reports" 8; Shot "reports" }
if (& $want "overview") { Go "/portal#overview" 10; Shot "portal_overview" }
if (& $want "map") { Go "/portal#map" 16; Shot "portal_map" }
if (& $want "hindukush") { Go "/portal#hindukush" 18; Shot "hindukush" }
if (& $want "karakoram") { Go "/portal#karakoram" 24; Shot "karakoram" }
if (& $want "models") { Go "/models" 14; Shot "models" }
if (& $want "kkh") { Go "/kkh" 20; Shot "kkh" }

if ($script:errs.Count) { "page exceptions:"; $script:errs | Select-Object -Unique | ForEach-Object { "  $_" } }
$ws.Dispose()
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$prof*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
