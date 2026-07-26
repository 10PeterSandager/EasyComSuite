# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom Remote App — Windows Installer
#  Kør: Dobbeltklik på filen (behøver IKKE administratorrettigheder)
#  Bruges typisk på teknikermaskinen for at generere QR-kode til talent
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
Write-Host "  Remote App — Windows Installer (QR-kode generator)" -ForegroundColor White
Write-Host ""

# ── Collect server domain ─────────────────────────────────────────────────────
Write-Host "  Hvad er EasyCom-serverens adresse?" -ForegroundColor White
$Domain = Read-Host "  Server domain (f.eks. myeasycom.duckdns.org)"
Write-Host ""

$RemoteUrl   = "https://${Domain}:3000/remote"
$UserDesktop = [Environment]::GetFolderPath("Desktop")
$QrFile      = Join-Path $UserDesktop "EasyCom Remote QR.html"

# ── Desktop shortcut ──────────────────────────────────────────────────────────
@"
[InternetShortcut]
URL=$RemoteUrl
"@ | Set-Content -Path (Join-Path $UserDesktop "EasyCom Remote.url") -Encoding ASCII
Log "Skrivebordsgenvej oprettet: EasyCom Remote"

# ── QR-kode HTML (åbnes i browser — scan med telefon) ────────────────────────
@"
<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<title>EasyCom Remote — QR-kode</title>
<style>
  body { background:#111; color:#eee; font-family:sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0 }
  h1 { color:#f97316; margin-bottom:8px; font-size:1.6rem }
  p  { color:#94a3b8; margin:4px 0 24px; font-size:.95rem }
  #qr { background:#fff; padding:16px; border-radius:12px }
  a  { color:#f97316; font-size:.85rem; margin-top:20px; word-break:break-all }
</style>
</head>
<body>
<h1>EasyCom Remote</h1>
<p>Scan med talent-telefonen for at åbne appen</p>
<div id="qr"></div>
<a href="$RemoteUrl" target="_blank">$RemoteUrl</a>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
  new QRCode(document.getElementById('qr'), {
    text: "$RemoteUrl",
    width: 260,
    height: 260,
    colorDark: "#000",
    colorLight: "#fff",
    correctLevel: QRCode.CorrectLevel.H
  })
</script>
</body>
</html>
"@ | Set-Content -Path $QrFile -Encoding UTF8

Start-Process $QrFile
Log "QR-kode åbnet i browser"

# ── Uninstaller ───────────────────────────────────────────────────────────────
$UninstallPs1 = Join-Path $UserDesktop "Afinstaller EasyCom Remote.ps1"
@"
`$D = [Environment]::GetFolderPath('Desktop')
Remove-Item (Join-Path `$D 'EasyCom Remote.url')          -ErrorAction SilentlyContinue
Remove-Item (Join-Path `$D 'EasyCom Remote QR.html')      -ErrorAction SilentlyContinue
Remove-Item (Join-Path `$D 'Afinstaller EasyCom Remote.lnk') -ErrorAction SilentlyContinue
Remove-Item '$UninstallPs1' -ErrorAction SilentlyContinue
Write-Host 'EasyCom Remote afinstalleret.'
"@ | Set-Content -Path $UninstallPs1 -Encoding UTF8

$WshShell = New-Object -ComObject WScript.Shell
$Lnk = $WshShell.CreateShortcut((Join-Path $UserDesktop "Afinstaller EasyCom Remote.lnk"))
$Lnk.TargetPath  = "powershell.exe"
$Lnk.Arguments   = "-ExecutionPolicy Bypass -File `"$UninstallPs1`""
$Lnk.Description = "Afinstaller EasyCom Remote"
$Lnk.Save()
Log "Afinstallationsgenvej oprettet"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "    EasyCom Remote klar!" -ForegroundColor Green
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  QR-koden er aabnet i browseren."
Write-Host "  Vis den til talent/artisten — de scanner den med telefonen."
Write-Host ""
Write-Host "  URL: $RemoteUrl" -ForegroundColor White
Write-Host "  Krav: EasyCom Server skal koere paa $Domain" -ForegroundColor DarkGray
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
