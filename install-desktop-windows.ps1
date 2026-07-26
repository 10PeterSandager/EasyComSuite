# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom Desktop App — Windows Installer
#  Kør: Dobbeltklik på filen (behøver IKKE administratorrettigheder)
# ─────────────────────────────────────────────────────────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Log  { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "  [!!]  $m" -ForegroundColor Yellow }

Clear-Host
Write-Host ""
Write-Host "  ███████╗ █████╗ ███████╗██╗   ██╗ ██████╗ ██████╗ ███╗   ███╗" -ForegroundColor Cyan
Write-Host "  ██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██╔═══██╗████╗ ████║" -ForegroundColor Cyan
Write-Host "  █████╗  ███████║███████╗ ╚████╔╝ ██║     ██║   ██║██╔████╔██║" -ForegroundColor Cyan
Write-Host "  ██╔══╝  ██╔══██║╚════██║  ╚██╔╝  ██║     ██║   ██║██║╚██╔╝██║" -ForegroundColor Cyan
Write-Host "  ███████╗██║  ██║███████║   ██║   ╚██████╗╚██████╔╝██║ ╚═╝ ██║" -ForegroundColor Cyan
Write-Host "  ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝     ╚═╝" -ForegroundColor Cyan
Write-Host "  Desktop App — Windows Installer" -ForegroundColor White
Write-Host ""

# ── Collect server domain ─────────────────────────────────────────────────────
Write-Host "  Hvad er EasyCom-serverens adresse?" -ForegroundColor White
$Domain = Read-Host "  Server domain (f.eks. myeasycom.duckdns.org)"
Write-Host ""

$DesktopUrl  = "https://${Domain}:3000/desktop"
$UserDesktop = [Environment]::GetFolderPath("Desktop")

# ── Desktop shortcut (.url åbner i standard browser) ─────────────────────────
@"
[InternetShortcut]
URL=$DesktopUrl
"@ | Set-Content -Path (Join-Path $UserDesktop "EasyCom Desktop.url") -Encoding ASCII
Log "Skrivebordsgenvej oprettet: EasyCom Desktop"

# ── Uninstaller ───────────────────────────────────────────────────────────────
$UninstallPs1 = Join-Path $UserDesktop "Afinstaller EasyCom Desktop.ps1"
@"
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'EasyCom Desktop.url') -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Afinstaller EasyCom Desktop.lnk') -ErrorAction SilentlyContinue
Remove-Item '$UninstallPs1' -ErrorAction SilentlyContinue
Write-Host 'EasyCom Desktop afinstalleret.'
"@ | Set-Content -Path $UninstallPs1 -Encoding UTF8

$WshShell = New-Object -ComObject WScript.Shell
$Lnk = $WshShell.CreateShortcut((Join-Path $UserDesktop "Afinstaller EasyCom Desktop.lnk"))
$Lnk.TargetPath  = "powershell.exe"
$Lnk.Arguments   = "-ExecutionPolicy Bypass -File `"$UninstallPs1`""
$Lnk.Description = "Afinstaller EasyCom Desktop"
$Lnk.Save()
Log "Afinstallationsgenvej oprettet"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "    EasyCom Desktop klar!" -ForegroundColor Green
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Dobbeltklik paa 'EasyCom Desktop' paa skrivebordet for at starte."
Write-Host "  URL: $DesktopUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Krav: EasyCom Server skal koere paa $Domain" -ForegroundColor DarkGray
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
