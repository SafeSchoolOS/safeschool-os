# ==============================================================================
# SafeSchool OS -- Bootable USB Installer Builder (Windows)
# ==============================================================================
# Copyright (c) 2026 SafeSchool. All rights reserved.
# Licensed under the SafeSchool Platform License.
#
# Creates a bootable USB installer that provisions a fresh mini PC with
# Ubuntu Server 24.04 LTS and auto-installs the SafeSchool edge stack.
#
# Usage:
#   .\build-usb.ps1 -DriveLetter E
#   .\build-usb.ps1 -IsoOnly
#
# Requirements:
#   - Windows 10/11 or Windows Server 2016+
#   - PowerShell 5.1+
#   - Administrator privileges (for USB operations)
#   - Internet connection (for ISO and Rufus download)
# ==============================================================================

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$DriveLetter,

    [Parameter(Mandatory = $false)]
    [switch]$IsoOnly,

    [Parameter(Mandatory = $false)]
    [string]$WorkDir,

    [Parameter(Mandatory = $false)]
    [switch]$SkipDownload
)

# -- Configuration ------------------------------------------------------------
$UbuntuVersion    = "24.04.2"
$UbuntuIsoUrl     = "https://releases.ubuntu.com/$UbuntuVersion/ubuntu-$UbuntuVersion-live-server-amd64.iso"
$UbuntuIsoFile    = "ubuntu-$UbuntuVersion-live-server-amd64.iso"
$Sha256Url        = "https://releases.ubuntu.com/$UbuntuVersion/SHA256SUMS"
$RufusUrl         = "https://github.com/pbatard/rufus/releases/download/v4.6/rufus-4.6p.exe"
$RufusExe         = "rufus-4.6p.exe"
$ScriptDir        = $PSScriptRoot
$ErrorActionPreference = "Stop"

if (-not $WorkDir) {
    $WorkDir = Join-Path $ScriptDir "build"
}

# -- Banner --------------------------------------------------------------------
function Write-Banner {
    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host "  SafeSchool OS -- USB Installer Builder (Windows)" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""
}

# -- Logging -------------------------------------------------------------------
function Write-LogInfo    { param([string]$Msg) Write-Host "[INFO]    $Msg" -ForegroundColor Blue }
function Write-LogSuccess { param([string]$Msg) Write-Host "[OK]      $Msg" -ForegroundColor Green }
function Write-LogWarn    { param([string]$Msg) Write-Host "[WARN]    $Msg" -ForegroundColor Yellow }
function Write-LogError   { param([string]$Msg) Write-Host "[ERROR]   $Msg" -ForegroundColor Red }

# -- Admin Privilege Check -----------------------------------------------------
function Assert-AdminPrivileges {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-LogError "This script requires Administrator privileges."
        Write-Host ""
        Write-Host "Right-click PowerShell and select 'Run as Administrator', then re-run this script." -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    Write-LogSuccess "Running with Administrator privileges."
}

# -- Validate Parameters -------------------------------------------------------
function Assert-Parameters {
    if (-not $IsoOnly -and -not $DriveLetter) {
        Write-LogError "You must specify -DriveLetter (e.g., E) or -IsoOnly."
        Write-Host ""
        Write-Host "Usage:" -ForegroundColor White
        Write-Host "  .\build-usb.ps1 -DriveLetter E        # Build and flash to USB drive E:" -ForegroundColor Gray
        Write-Host "  .\build-usb.ps1 -IsoOnly               # Build ISO only (no flash)" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }

    if ($DriveLetter) {
        # Normalize: remove trailing colon/backslash
        $script:DriveLetter = $DriveLetter.TrimEnd(':', '\', '/')
        if ($DriveLetter.Length -ne 1 -or $DriveLetter -notmatch '^[D-Zd-z]$') {
            Write-LogError "Invalid drive letter: $DriveLetter. Use a letter from D to Z."
            exit 1
        }
        $script:DriveLetter = $DriveLetter.ToUpper()

        # Safety: refuse system drive
        $systemDrive = $env:SystemDrive.TrimEnd(':')
        if ($DriveLetter -eq $systemDrive) {
            Write-LogError "Refusing to flash to system drive ${DriveLetter}:!"
            exit 1
        }
    }
}

# -- Download File with Progress -----------------------------------------------
function Get-FileWithProgress {
    param(
        [string]$Url,
        [string]$OutFile,
        [string]$Description
    )

    Write-LogInfo "Downloading $Description..."
    Write-LogInfo "URL: $Url"

    # Use BITS for large files (ISO), WebClient for smaller files
    $fileSize = 0
    try {
        $request = [System.Net.WebRequest]::Create($Url)
        $request.Method = "HEAD"
        $response = $request.GetResponse()
        $fileSize = $response.ContentLength
        $response.Close()
    } catch {
        Write-LogWarn "Could not determine file size. Downloading anyway..."
    }

    if ($fileSize -gt 100MB) {
        # Use BITS transfer for large files (shows progress)
        Write-LogInfo "Using BITS transfer for large file ($([math]::Round($fileSize / 1GB, 2)) GB)..."
        try {
            Start-BitsTransfer -Source $Url -Destination $OutFile -Description $Description -DisplayName "SafeSchool USB Builder"
        } catch {
            Write-LogWarn "BITS transfer failed, falling back to WebClient..."
            $webClient = New-Object System.Net.WebClient
            $webClient.DownloadFile($Url, $OutFile)
        }
    } else {
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($Url, $OutFile)
    }

    if (-not (Test-Path $OutFile)) {
        Write-LogError "Failed to download: $OutFile"
        exit 1
    }

    Write-LogSuccess "Downloaded: $OutFile"
}

# -- Download Ubuntu ISO -------------------------------------------------------
function Get-UbuntuIso {
    $isoPath = Join-Path $WorkDir $UbuntuIsoFile

    if ((Test-Path $isoPath) -and $SkipDownload) {
        Write-LogInfo "Using existing ISO: $isoPath"
        return $isoPath
    }

    if (Test-Path $isoPath) {
        Write-LogInfo "ISO already exists. Verifying checksum..."

        # Download SHA256SUMS
        $sha256File = Join-Path $WorkDir "SHA256SUMS"
        try {
            $webClient = New-Object System.Net.WebClient
            $webClient.DownloadFile($Sha256Url, $sha256File)
        } catch {
            Write-LogWarn "Could not download SHA256SUMS for verification."
        }

        if (Test-Path $sha256File) {
            $sha256Content = Get-Content $sha256File
            $expectedLine = $sha256Content | Where-Object { $_ -match $UbuntuIsoFile }
            if ($expectedLine) {
                $expectedHash = ($expectedLine -split '\s+')[0]
                $actualHash = (Get-FileHash -Path $isoPath -Algorithm SHA256).Hash.ToLower()

                if ($expectedHash -eq $actualHash) {
                    Write-LogSuccess "ISO checksum verified."
                    return $isoPath
                } else {
                    Write-LogWarn "Checksum mismatch. Re-downloading ISO..."
                    Remove-Item $isoPath -Force
                }
            }
        }
    }

    if (-not (Test-Path $isoPath)) {
        Get-FileWithProgress -Url $UbuntuIsoUrl -OutFile $isoPath -Description "Ubuntu Server $UbuntuVersion LTS ISO"
    }

    return $isoPath
}

# -- Download Rufus Portable ---------------------------------------------------
function Get-Rufus {
    $rufusPath = Join-Path $WorkDir $RufusExe

    if (Test-Path $rufusPath) {
        Write-LogInfo "Rufus already downloaded: $rufusPath"
        return $rufusPath
    }

    Get-FileWithProgress -Url $RufusUrl -OutFile $rufusPath -Description "Rufus Portable"
    return $rufusPath
}

# -- Prepare Autoinstall Files -------------------------------------------------
function New-AutoinstallOverlay {
    param([string]$ExtractDir)

    Write-LogInfo "Preparing autoinstall overlay..."

    $autoinstallDir = Join-Path $ExtractDir "autoinstall"
    New-Item -ItemType Directory -Path $autoinstallDir -Force | Out-Null

    # Copy user-data and meta-data
    $userDataSrc = Join-Path $ScriptDir "user-data"
    $metaDataSrc = Join-Path $ScriptDir "meta-data"

    if (-not (Test-Path $userDataSrc)) {
        Write-LogError "user-data not found at $userDataSrc"
        exit 1
    }
    if (-not (Test-Path $metaDataSrc)) {
        Write-LogError "meta-data not found at $metaDataSrc"
        exit 1
    }

    Copy-Item $userDataSrc (Join-Path $autoinstallDir "user-data") -Force
    Copy-Item $metaDataSrc (Join-Path $autoinstallDir "meta-data") -Force

    # Copy helper scripts if they exist
    $firstBootSrc = Join-Path $ScriptDir "first-boot.sh"
    $motdSrc = Join-Path $ScriptDir "safeschool-motd.sh"

    if (Test-Path $firstBootSrc) {
        Copy-Item $firstBootSrc (Join-Path $autoinstallDir "first-boot.sh") -Force
    }
    if (Test-Path $motdSrc) {
        Copy-Item $motdSrc (Join-Path $autoinstallDir "safeschool-motd.sh") -Force
    }

    Write-LogSuccess "Autoinstall overlay prepared."
    return $autoinstallDir
}

# -- Method 1: Rufus Portable -------------------------------------------------
function Invoke-RufusFlash {
    param(
        [string]$IsoPath,
        [string]$DriveLetterParam
    )

    $rufusPath = Get-Rufus

    Write-LogInfo "Preparing USB drive ${DriveLetterParam}: with Rufus..."
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  WARNING: USB FLASH OPERATION" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Drive: ${DriveLetterParam}:" -ForegroundColor White

    # Get disk info
    $volume = Get-Volume -DriveLetter $DriveLetterParam -ErrorAction SilentlyContinue
    if ($volume) {
        Write-Host "  Label: $($volume.FileSystemLabel)" -ForegroundColor White
        Write-Host "  Size:  $([math]::Round($volume.Size / 1GB, 2)) GB" -ForegroundColor White
    }

    Write-Host ""
    Write-Host "  ALL DATA ON THIS DRIVE WILL BE DESTROYED!" -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "  Type 'YES' (uppercase) to confirm"

    if ($confirm -ne "YES") {
        Write-LogInfo "Flash cancelled by user."
        return
    }

    # Rufus portable with DD mode for ISO writing
    # Note: Rufus portable supports limited CLI automation.
    # We use the -i (ISO), -d (device) flags available in newer versions.
    Write-LogInfo "Launching Rufus to flash the ISO..."
    Write-LogInfo "Rufus will open in GUI mode. Select the following settings:"
    Write-Host ""
    Write-Host "  1. Device:       ${DriveLetterParam}:" -ForegroundColor Cyan
    Write-Host "  2. Boot type:    Select the ISO file" -ForegroundColor Cyan
    Write-Host "  3. Partition:    GPT" -ForegroundColor Cyan
    Write-Host "  4. Target:       UEFI (non CSM)" -ForegroundColor Cyan
    Write-Host "  5. File system:  FAT32 (Large)" -ForegroundColor Cyan
    Write-Host "  6. Click START, select 'Write in DD Image mode' if prompted" -ForegroundColor Cyan
    Write-Host ""

    # Start Rufus with the ISO pre-selected
    Start-Process -FilePath $rufusPath -ArgumentList "-i `"$IsoPath`"" -Wait

    Write-LogSuccess "Rufus operation complete."
    Write-Host ""
    Write-Host "After Rufus finishes, copy the autoinstall files to the USB drive." -ForegroundColor Yellow
    Write-Host ""
}

# -- Method 2: Direct copy (for UEFI-only boot) -------------------------------
function Invoke-DirectCopy {
    param(
        [string]$IsoPath,
        [string]$DriveLetterParam
    )

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  WARNING: USB FORMAT OPERATION" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Drive: ${DriveLetterParam}:" -ForegroundColor White

    $volume = Get-Volume -DriveLetter $DriveLetterParam -ErrorAction SilentlyContinue
    if ($volume) {
        Write-Host "  Label: $($volume.FileSystemLabel)" -ForegroundColor White
        Write-Host "  Size:  $([math]::Round($volume.Size / 1GB, 2)) GB" -ForegroundColor White
    }

    Write-Host ""
    Write-Host "  ALL DATA ON THIS DRIVE WILL BE DESTROYED!" -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "  Type 'YES' (uppercase) to confirm"

    if ($confirm -ne "YES") {
        Write-LogInfo "Flash cancelled by user."
        return
    }

    # Format the USB drive as FAT32
    Write-LogInfo "Formatting ${DriveLetterParam}: as FAT32..."
    Format-Volume -DriveLetter $DriveLetterParam -FileSystem FAT32 -NewFileSystemLabel "SAFESCHOOL" -Confirm:$false

    # Mount the ISO
    Write-LogInfo "Mounting ISO..."
    $mountResult = Mount-DiskImage -ImagePath $IsoPath -PassThru
    $isoDriveLetter = ($mountResult | Get-Volume).DriveLetter

    if (-not $isoDriveLetter) {
        Write-LogError "Failed to mount ISO."
        Dismount-DiskImage -ImagePath $IsoPath | Out-Null
        exit 1
    }

    Write-LogInfo "ISO mounted as ${isoDriveLetter}:"

    # Copy ISO contents to USB
    Write-LogInfo "Copying ISO contents to USB drive (this may take a few minutes)..."
    $isoRoot = "${isoDriveLetter}:\"
    $usbRoot = "${DriveLetterParam}:\"

    robocopy $isoRoot $usbRoot /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null

    # Unmount ISO
    Dismount-DiskImage -ImagePath $IsoPath | Out-Null
    Write-LogSuccess "ISO contents copied."

    # Copy autoinstall files
    Write-LogInfo "Injecting autoinstall configuration..."
    $autoinstallDir = Join-Path $usbRoot "autoinstall"
    New-Item -ItemType Directory -Path $autoinstallDir -Force | Out-Null

    Copy-Item (Join-Path $ScriptDir "user-data") (Join-Path $autoinstallDir "user-data") -Force
    Copy-Item (Join-Path $ScriptDir "meta-data") (Join-Path $autoinstallDir "meta-data") -Force

    if (Test-Path (Join-Path $ScriptDir "first-boot.sh")) {
        Copy-Item (Join-Path $ScriptDir "first-boot.sh") (Join-Path $autoinstallDir "first-boot.sh") -Force
    }
    if (Test-Path (Join-Path $ScriptDir "safeschool-motd.sh")) {
        Copy-Item (Join-Path $ScriptDir "safeschool-motd.sh") (Join-Path $autoinstallDir "safeschool-motd.sh") -Force
    }

    # Patch GRUB to add autoinstall parameter
    $grubCfg = Join-Path $usbRoot "boot\grub\grub.cfg"
    if (Test-Path $grubCfg) {
        Write-LogInfo "Patching GRUB configuration..."
        $content = Get-Content $grubCfg -Raw
        $content = $content -replace '---', ' autoinstall ds=nocloud;s=/cdrom/autoinstall/ ---'
        Set-Content -Path $grubCfg -Value $content -NoNewline
        Write-LogSuccess "GRUB patched for autoinstall."
    }

    Write-LogSuccess "USB drive prepared successfully!"
}

# -- Main Entry ----------------------------------------------------------------
function Main {
    Write-Banner

    # Check admin privileges (required for disk operations)
    if (-not $IsoOnly) {
        Assert-AdminPrivileges
    }

    Assert-Parameters

    # Create work directory
    if (-not (Test-Path $WorkDir)) {
        New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
    }

    # Step 1: Download Ubuntu ISO
    Write-Host ""
    Write-Host "Step 1/3: Download Ubuntu Server ISO" -ForegroundColor White
    $isoPath = Get-UbuntuIso

    if ($IsoOnly) {
        Write-Host ""
        Write-LogSuccess "ISO downloaded to: $isoPath"
        Write-Host ""
        Write-Host "To create a USB installer, re-run with:" -ForegroundColor Yellow
        Write-Host "  .\build-usb.ps1 -DriveLetter E" -ForegroundColor Gray
        Write-Host ""
        return
    }

    # Step 2: Prepare method selection
    Write-Host ""
    Write-Host "Step 2/3: Select USB creation method" -ForegroundColor White
    Write-Host ""
    Write-Host "  1) Rufus (recommended -- handles BIOS + UEFI boot)" -ForegroundColor Cyan
    Write-Host "  2) Direct copy (UEFI-only boot, no extra tools needed)" -ForegroundColor Cyan
    Write-Host ""
    $method = Read-Host "Select method [1/2]"

    # Step 3: Flash to USB
    Write-Host ""
    Write-Host "Step 3/3: Create USB installer" -ForegroundColor White

    switch ($method) {
        "2" {
            Invoke-DirectCopy -IsoPath $isoPath -DriveLetterParam $DriveLetter
        }
        default {
            Invoke-RufusFlash -IsoPath $isoPath -DriveLetterParam $DriveLetter
        }
    }

    # Summary
    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host "  SafeSchool Edge USB Installer -- Complete" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host "    1. Insert the USB drive into the target mini PC" -ForegroundColor Gray
    Write-Host "    2. Boot from USB (change BIOS boot order if needed)" -ForegroundColor Gray
    Write-Host "    3. Installation is fully automated -- hands off" -ForegroundColor Gray
    Write-Host "    4. After reboot, log in as: safeschool (password set during install)" -ForegroundColor Gray
    Write-Host "    5. Run: sudo safeschool config  (to set SITE_ID)" -ForegroundColor Gray
    Write-Host ""
}

Main
