# SafeSchoolOS Windows Gateway Installer
# Installs EdgeRuntime as a Windows service (gateway mode only, no local SafeSchool app)
#
# Usage: Run as Administrator
#   .\install.ps1 -ActivationKey "XXXX-XXXX-XXXX-XXXX" -SiteId "my-school"

param(
    [Parameter(Mandatory=$true)]
    [string]$ActivationKey,

    [Parameter(Mandatory=$true)]
    [string]$SiteId,

    [string]$InstallDir = "C:\SafeSchoolOS",
    [string]$DataDir = "C:\SafeSchoolOS\data",
    [int]$ApiPort = 8470
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " SafeSchoolOS Gateway - Windows Installer"  -ForegroundColor Cyan
Write-Host " Mode: Gateway (sync only, no local UI)"    -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check for admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Must run as Administrator" -ForegroundColor Red
    exit 1
}

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js not found. Install Node.js 20+ first." -ForegroundColor Red
    exit 1
}

# Create directories
Write-Host "Creating directories..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Write config
$configContent = @"
# SafeSchoolOS Gateway Configuration
# Mode: Gateway (EdgeRuntime sync only, no local SafeSchool app)

activationKey: "$ActivationKey"
siteId: "$SiteId"
dataDir: "$($DataDir -replace '\\', '/')"
apiPort: $ApiPort
syncIntervalMs: 30000
healthCheckIntervalMs: 15000
moduleDirs:
  - "./modules"
"@

$configPath = Join-Path $InstallDir "config.yaml"
Set-Content -Path $configPath -Value $configContent
Write-Host "Config written to: $configPath" -ForegroundColor Green

# Write .env for commercial proxy overrides (if needed)
$envContent = @"
# Commercial proxy URLs (set these for non-SafeSchool products)
# EDGERUNTIME_PROXY_1=https://your-badgekiosk-cloud.com
# EDGERUNTIME_PROXY_2=https://your-buildkiosk-cloud.com
# EDGERUNTIME_PROXY_3=https://your-badgeguard-cloud.com
# EDGERUNTIME_PROXY_4=https://your-accessgsoc-cloud.com
# EDGERUNTIME_PROXY_5=https://your-mechanickiosk-cloud.com

# HMAC secret for activation key verification
# EDGERUNTIME_HMAC_SECRET=change-this-in-production
"@

$envPath = Join-Path $InstallDir ".env"
if (-not (Test-Path $envPath)) {
    Set-Content -Path $envPath -Value $envContent
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Copy EdgeRuntime files to: $InstallDir"
Write-Host "  2. Run: cd $InstallDir && npm install"
Write-Host "  3. Run: npm run build"
Write-Host "  4. Install as service: node deploy/windows/install-service.js"
Write-Host "  5. Or run directly: npm start"
Write-Host ""
Write-Host "Health check: http://localhost:$ApiPort/health"
