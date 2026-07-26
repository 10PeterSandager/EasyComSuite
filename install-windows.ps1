# ─────────────────────────────────────────────────────────────────────────────
#  EasyCom Server — Windows Installer
#  Run as Administrator: Right-click → "Run with PowerShell as Administrator"
# ─────────────────────────────────────────────────────────────────────────────
#Requires -RunAsAdministrator
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$TaskName    = "EasyCom Server"

function Log  { param($m) Write-Host "  [OK]  $m" -ForegroundColor Green }
function Warn { param($m) Write-Host "  [!!]  $m" -ForegroundColor Yellow }
function Err  { param($m) Write-Host "  [XX]  $m" -ForegroundColor Red; exit 1 }

Clear-Host
Write-Host ""
Write-Host "  ███████╗ █████╗ ███████╗██╗   ██╗ ██████╗ ██████╗ ███╗   ███╗" -ForegroundColor Cyan
Write-Host "  ██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██╔═══██╗████╗ ████║" -ForegroundColor Cyan
Write-Host "  █████╗  ███████║███████╗ ╚████╔╝ ██║     ██║   ██║██╔████╔██║" -ForegroundColor Cyan
Write-Host "  ██╔══╝  ██╔══██║╚════██║  ╚██╔╝  ██║     ██║   ██║██║╚██╔╝██║" -ForegroundColor Cyan
Write-Host "  ███████╗██║  ██║███████║   ██║   ╚██████╗╚██████╔╝██║ ╚═╝ ██║" -ForegroundColor Cyan
Write-Host "  ╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝     ╚═╝" -ForegroundColor Cyan
Write-Host "  Broadcast Intercom Server — Windows Installer" -ForegroundColor White
Write-Host ""

# ── Node.js ───────────────────────────────────────────────────────────────────
$NodePath = $null
try { $NodePath = (Get-Command node -ErrorAction Stop).Source } catch {}

if (-not $NodePath) {
    Warn "Node.js not found. Installing via winget..."
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
    try { $NodePath = (Get-Command node -ErrorAction Stop).Source } catch {
        Err "Node.js install failed. Please install manually from https://nodejs.org and re-run."
    }
}
Log "Node.js ready ($(node --version))"

# ── Auto-detect local IP ──────────────────────────────────────────────────────
$LocalIp = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -ne "127.0.0.1" } |
    Select-Object -First 1 -ExpandProperty IPAddress
) ?? "127.0.0.1"
Log "Local IP: $LocalIp"

# ── Self-signed SSL certificate ───────────────────────────────────────────────
$SslDir  = "C:\EasyCom\ssl"
$CertPem = "$SslDir\cert.pem"
$KeyPem  = "$SslDir\key.pem"

if (-not (Test-Path $CertPem)) {
    New-Item -ItemType Directory -Force -Path $SslDir | Out-Null

    # Use PowerShell's built-in cert generation, then export to PEM
    $Cert = New-SelfSignedCertificate `
        -DnsName "localhost","easycom-local" `
        -IPAddress "127.0.0.1",$LocalIp `
        -CertStoreLocation "Cert:\LocalMachine\My" `
        -NotAfter (Get-Date).AddYears(10) `
        -KeyAlgorithm RSA -KeyLength 2048

    # Export cert to PEM
    $CertBytes = $Cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $CertB64   = [System.Convert]::ToBase64String($CertBytes, 'InsertLineBreaks')
    "-----BEGIN CERTIFICATE-----`n$CertB64`n-----END CERTIFICATE-----" | Set-Content $CertPem -Encoding ASCII

    # Export private key via PFX then openssl (if available) or store thumbprint
    $PfxPath = "$SslDir\temp.pfx"
    $PfxPw   = ConvertTo-SecureString "easycom_temp" -AsPlainText -Force
    Export-PfxCertificate -Cert $Cert -FilePath $PfxPath -Password $PfxPw | Out-Null

    # Try openssl for key extraction
    $opensslPath = (Get-Command openssl -ErrorAction SilentlyContinue)?.Source
    if ($opensslPath) {
        & openssl pkcs12 -in $PfxPath -nocerts -nodes -out $KeyPem -passin pass:easycom_temp 2>$null
    } else {
        Warn "openssl not found — SSL key extraction skipped. Install openssl or use a reverse proxy."
        $KeyPem = ""
    }
    Remove-Item $PfxPath -ErrorAction SilentlyContinue
    Log "Self-signed SSL certificate created"
} else {
    Log "SSL certificate already exists — reusing"
}

# ── Write default .env (user configures via Host UI → Setup → Server) ─────────
$EnvPath = Join-Path $ScriptDir ".env"
if (-not (Test-Path $EnvPath)) {
    $SslCertLine = "SSL_CERT_PATH="
    $SslKeyLine  = "SSL_KEY_PATH="
    @"
PORT=3000
MEDIASOUP_ANNOUNCED_IP=$LocalIp
TURN_URL=
TURN_USERNAME=
TURN_PASSWORD=
SESSION_PASSWORD=
$SslCertLine
$SslKeyLine
"@ | Set-Content -Path $EnvPath -Encoding UTF8
    Log ".env created (configure TURN + session via Host UI → Setup → Server)"
} else {
    Log ".env exists — preserving config"
}

# ── Install npm dependencies ──────────────────────────────────────────────────
Write-Host "  Installing Node dependencies..."
Push-Location $ScriptDir
& npm install --silent
if ($LASTEXITCODE -ne 0) { Err "npm install failed" }
Log "Dependencies installed"

# ── Build server ──────────────────────────────────────────────────────────────
Write-Host "  Building server..."
& npm run build --silent
if ($LASTEXITCODE -ne 0) { Err "npm build failed" }
Log "Server built"
Pop-Location

# ── Build host UI ─────────────────────────────────────────────────────────────
$AppDirs = @( (Join-Path $ScriptDir "..\..\easycom-broadcast-intercom") )
foreach ($AppDir in $AppDirs) {
    $AppName = Split-Path $AppDir -Leaf
    if (Test-Path $AppDir) {
        Write-Host "  Building $AppName..."
        Push-Location $AppDir
        & npm install --silent
        if ($LASTEXITCODE -ne 0) { Err "npm install failed in $AppName" }
        & npm run build --silent
        if ($LASTEXITCODE -ne 0) { Err "npm build failed in $AppName" }
        Pop-Location
        Log "$AppName built"
    } else {
        Warn "$AppName ikke fundet — springer over"
    }
}

# ── Windows Firewall ──────────────────────────────────────────────────────────
Write-Host "  Configuring Windows Firewall..."
$FwTcp = @{ Protocol = "TCP"; LocalPort = 3000; Action = "Allow"; Direction = "Inbound"; DisplayName = "EasyCom Signaling (TCP 3000)" }
if (-not (Get-NetFirewallRule -DisplayName $FwTcp.DisplayName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule @FwTcp | Out-Null
}
$FwUdp = @{ Protocol = "UDP"; LocalPort = "40000-49999"; Action = "Allow"; Direction = "Inbound"; DisplayName = "EasyCom RTC Audio/Video (UDP 40000-49999)" }
if (-not (Get-NetFirewallRule -DisplayName $FwUdp.DisplayName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule @FwUdp | Out-Null
}
Log "Firewall rules added"

# ── Startup task ──────────────────────────────────────────────────────────────
$ServerJs = Join-Path $ScriptDir "dist\server.js"
$Action   = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ServerJs`"" -WorkingDirectory $ScriptDir
$Trigger  = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$Principal= New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
Start-ScheduledTask -TaskName $TaskName
Log "Auto-start service registered and started"

# ── Desktop shortcut (.url) ───────────────────────────────────────────────────
$PublicDesktop = "C:\Users\Public\Desktop"
$HostUrl       = "http://localhost:3000/host"
@"
[InternetShortcut]
URL=$HostUrl
"@ | Set-Content -Path (Join-Path $PublicDesktop "EasyCom Host.url") -Encoding ASCII
Log "Skrivebordsikon oprettet (EasyCom Host)"

# ── Uninstaller ───────────────────────────────────────────────────────────────
$UninstallScript = Join-Path $ScriptDir "uninstall-windows.ps1"
@'
#Requires -RunAsAdministrator
$TaskName = "EasyCom Server"
Write-Host "Afinstallerer EasyCom Server..."
Stop-ScheduledTask   -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "EasyCom Signaling (TCP 3000)" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "EasyCom RTC Audio/Video (UDP 40000-49999)" -ErrorAction SilentlyContinue
Remove-Item "C:\Users\Public\Desktop\EasyCom Host.url" -ErrorAction SilentlyContinue
Write-Host "Faerdig."
'@ | Set-Content -Path $UninstallScript -Encoding UTF8

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "    EasyCom Server installed and running!" -ForegroundColor Green
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Host app  →  $HostUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Åbn Host-UI og gå til SETUP → SERVER" -ForegroundColor Cyan
Write-Host "  for at konfigurere TURN-server og session-adgangskode." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Serveren starter automatisk ved genstart." -ForegroundColor DarkGray
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""

# Open host in browser
Start-Process $HostUrl
