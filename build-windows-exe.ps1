# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom — Windows EXE Builder
#  Kør: Dobbeltklik (INGEN admin nødvendigt)
#  Krav: Kør én gang: Install-Module -Name ps2exe -Scope CurrentUser
#  Output: dist\  →  "EasyCom Server Setup.exe", "EasyCom Desktop Setup.exe", "EasyCom Remote Setup.exe"
# ─────────────────────────────────────────────────────────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$EasycomRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$DistDir     = Join-Path $ScriptDir "dist"
$TmpDir      = Join-Path ([IO.Path]::GetTempPath()) "easycom-build-$([Guid]::NewGuid().ToString('N').Substring(0,8))"

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
New-Item -ItemType Directory -Path $TmpDir  -Force | Out-Null

function Log  { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "  [!!]  $m" -ForegroundColor Yellow }
function Err  { param($m) Write-Host "  [XX]  $m" -ForegroundColor Red; exit 1 }

# ── Check / install ps2exe ─────────────────────────────────────────────────────
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "  Installerer ps2exe ..."
    Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
}
Import-Module ps2exe -Force
Log "ps2exe klar"

# ── Helper: copy source dir without node_modules/dist/.git ───────────────────
function Copy-Source {
    param($Src, $Dst)
    if (-not (Test-Path $Src)) { Warn "$Src ikke fundet — springer over"; return }
    $excludes = @('node_modules', 'dist', '.git')
    Get-ChildItem -Path $Src -Recurse | Where-Object {
        $rel = $_.FullName.Substring($Src.Length).TrimStart('\','/')
        $parts = $rel -split '[/\\]'
        -not ($excludes | Where-Object { $parts -contains $_ })
    } | ForEach-Object {
        $dest = Join-Path $Dst $_.FullName.Substring($Src.Length)
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Path $dest -Force | Out-Null
        } else {
            $parent = Split-Path $dest
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item $_.FullName $dest -Force
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  SERVER EXE
#  Pakker kildekode som Base64-zip inde i setup-scriptet → fuldt selvstændigt
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Bygger EasyCom Server EXE ..." -ForegroundColor Cyan

$ServerStage = Join-Path $TmpDir "server-stage"
New-Item -ItemType Directory -Path $ServerStage -Force | Out-Null

Copy-Source (Join-Path $EasycomRoot "easycom-host")               (Join-Path $ServerStage "easycom-host")
Copy-Source (Join-Path $EasycomRoot "easycom-broadcast-intercom") (Join-Path $ServerStage "easycom-broadcast-intercom")
Copy-Source (Join-Path $EasycomRoot "DESKTOP")                    (Join-Path $ServerStage "DESKTOP")
Copy-Source (Join-Path $EasycomRoot "easycom-remote")             (Join-Path $ServerStage "easycom-remote")

# Zip kildekoden
$SourceZip = Join-Path $TmpDir "easycom-server-source.zip"
Compress-Archive -Path (Join-Path $ServerStage "*") -DestinationPath $SourceZip -Force
$Base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($SourceZip))
Log ("Kildekode zippet: {0:N0} KB" -f ([IO.FileInfo]$SourceZip).Length / 1KB)

# Byg selvstændigt setup-script med embedded zip
$ServerSetupPs1 = Join-Path $TmpDir "EasyCom-Server-Setup.ps1"
@"
#Requires -RunAsAdministrator
`$ErrorActionPreference = 'Stop'
`$dest = 'C:\EasyCom'
`$tmp  = Join-Path ([IO.Path]::GetTempPath()) 'easycom-src.zip'

Write-Host ''
Write-Host '  Udpakker EasyCom ...' -ForegroundColor Cyan
[IO.File]::WriteAllBytes(`$tmp, [Convert]::FromBase64String('$Base64'))
Expand-Archive -Path `$tmp -DestinationPath `$dest -Force
Remove-Item `$tmp -ErrorAction SilentlyContinue

Write-Host '  Starter installation ...' -ForegroundColor Cyan
`$install = Join-Path `$dest 'easycom-host\server\install-windows.ps1'
& powershell.exe -ExecutionPolicy Bypass -File "`$install"
"@ | Set-Content -Path $ServerSetupPs1 -Encoding UTF8

$ServerExe = Join-Path $DistDir "EasyCom Server Setup.exe"
Invoke-ps2exe -InputFile $ServerSetupPs1 -OutputFile $ServerExe `
    -Title "EasyCom Server Setup" -requireAdmin -noConsole:$false
Log "Oprettet: $ServerExe"

# ─────────────────────────────────────────────────────────────────────────────
#  DESKTOP EXE  (ingen kildekode — kun genvejsopretning)
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Bygger EasyCom Desktop EXE ..." -ForegroundColor Cyan

$DesktopPs1 = Join-Path $TmpDir "EasyCom-Desktop-Setup.ps1"
Get-Content (Join-Path $ScriptDir "install-desktop-windows.ps1") | Set-Content $DesktopPs1 -Encoding UTF8

$DesktopExe = Join-Path $DistDir "EasyCom Desktop Setup.exe"
Invoke-ps2exe -InputFile $DesktopPs1 -OutputFile $DesktopExe `
    -Title "EasyCom Desktop Setup" -requireAdmin:$false -noConsole:$false
Log "Oprettet: $DesktopExe"

# ─────────────────────────────────────────────────────────────────────────────
#  REMOTE EXE  (ingen kildekode — kun QR + genvej)
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Bygger EasyCom Remote EXE ..." -ForegroundColor Cyan

$RemotePs1 = Join-Path $TmpDir "EasyCom-Remote-Setup.ps1"
Get-Content (Join-Path $ScriptDir "install-remote-windows.ps1") | Set-Content $RemotePs1 -Encoding UTF8

$RemoteExe = Join-Path $DistDir "EasyCom Remote Setup.exe"
Invoke-ps2exe -InputFile $RemotePs1 -OutputFile $RemoteExe `
    -Title "EasyCom Remote Setup" -requireAdmin:$false -noConsole:$false
Log "Oprettet: $RemoteExe"

# ── Cleanup ───────────────────────────────────────────────────────────────────
Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "    Alle EXE-filer er klar i: $DistDir" -ForegroundColor Green
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Get-ChildItem $DistDir -Filter *.exe | ForEach-Object {
    Write-Host ("    {0,-40} {1,6:N0} KB" -f $_.Name, ($_.Length / 1KB))
}
Write-Host ""
