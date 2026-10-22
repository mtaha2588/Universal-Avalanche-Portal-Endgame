# Upload the portal to the cloud server and install / update it, in one command.
#
#   powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Ip 140.238.1.2 -Key C:\Users\PC\Downloads\ssh-key.key
#
# -Ip   the server's public IP (Oracle console -> Instance details)
# -Key  the private key file you downloaded when creating the instance
# -User login name (Oracle Ubuntu images use "ubuntu")
# -NoHttps  skip the free HTTPS certificate
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$User = "ubuntu",
  [switch]$NoHttps
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path $Key)) { throw "Key file not found: $Key" }

# Windows OpenSSH refuses a private key that other users can read.
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):R" | Out-Null

Write-Host "==> Building the bundle"
$py = if (Test-Path ".venv\Scripts\python.exe") { ".venv\Scripts\python.exe" } else { "python" }
& $py deploy\make_bundle.py
if ($LASTEXITCODE -ne 0) { throw "Bundle build failed" }

$ssh = @("-i", $Key, "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30")

Write-Host "==> Uploading to $User@$Ip (about 17 MB)"
scp @ssh dist\avalanche-portal.zip dist\setup_server.sh "${User}@${Ip}:~/"
if ($LASTEXITCODE -ne 0) { throw "Upload failed. Check the IP, the key and that port 22 is open." }

Write-Host "==> Installing on the server (first run takes a few minutes)"
$flag = if ($NoHttps) { "" } else { "--https" }
ssh @ssh "${User}@${Ip}" "sudo bash ~/setup_server.sh $flag"
if ($LASTEXITCODE -ne 0) { throw "Server setup reported an error (see above)." }

Write-Host ""
Write-Host "Done. Share:  http://$Ip/" -ForegroundColor Green
if (-not $NoHttps) { Write-Host "HTTPS:        https://$($Ip -replace '\.', '-').sslip.io/" -ForegroundColor Green }
