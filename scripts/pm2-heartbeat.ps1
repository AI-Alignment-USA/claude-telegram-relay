# PM2 Heartbeat Watchdog
# Checks PM2 status every 5 minutes via Windows Task Scheduler.
# Restarts claude-telegram-relay if it's down, or PM2 itself if needed.

$ProjectDir = "C:\Users\crevi\claude-telegram-relay"
$LogFile = "$ProjectDir\logs\pm2-heartbeat.log"
$ProcessName = "claude-telegram-relay"
$EcosystemConfig = "$ProjectDir\ecosystem.config.cjs"

# Find pm2 - check known locations, then PATH
$Pm2Candidates = @(
    "C:\Users\crevi\.bun\bin\pm2.exe",
    "$env:USERPROFILE\.bun\bin\pm2.exe",
    "$env:APPDATA\npm\pm2.cmd"
)
$Pm2Path = $null
foreach ($candidate in $Pm2Candidates) {
    if (Test-Path $candidate) {
        $Pm2Path = $candidate
        break
    }
}
if (-not $Pm2Path) {
    $Pm2Path = (Get-Command pm2 -ErrorAction SilentlyContinue).Source
}
if (-not $Pm2Path) {
    Write-Log "CRITICAL: pm2 not found anywhere"
    exit 1
}

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] $Message"
    Add-Content -Path $LogFile -Value $entry
}

# Ensure log directory exists
$logDir = Split-Path $LogFile
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Trim log file if over 5000 lines
if (Test-Path $LogFile) {
    $lineCount = (Get-Content $LogFile | Measure-Object -Line).Lines
    if ($lineCount -gt 5000) {
        $lines = Get-Content $LogFile
        $lines | Select-Object -Last 2000 | Set-Content $LogFile
        Write-Log "Log trimmed from $lineCount to 2000 lines"
    }
}

# Check if pm2 is reachable
try {
    $pm2List = & $Pm2Path jlist 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "pm2 jlist failed"
    }
    $processes = $pm2List | ConvertFrom-Json
} catch {
    Write-Log "PM2 DEAD - Cannot reach PM2 daemon. Resurrecting..."
    try {
        & $Pm2Path resurrect 2>&1 | Out-Null
        Start-Sleep -Seconds 3
        $pm2List = & $Pm2Path jlist 2>&1
        $processes = $pm2List | ConvertFrom-Json
        Write-Log "PM2 resurrected successfully"
    } catch {
        Write-Log "PM2 resurrect failed. Starting from ecosystem config..."
        try {
            Set-Location $ProjectDir
            & $Pm2Path start $EcosystemConfig --only $ProcessName 2>&1 | Out-Null
            & $Pm2Path save 2>&1 | Out-Null
            Write-Log "Started $ProcessName from ecosystem config and saved"
        } catch {
            Write-Log "CRITICAL: Cannot start PM2 at all. Error: $_"
        }
        exit
    }
}

# Find the relay process
$relay = $processes | Where-Object { $_.name -eq $ProcessName }

if (-not $relay) {
    Write-Log "MISSING - $ProcessName not found in PM2. Starting..."
    Set-Location $ProjectDir
    & $Pm2Path start $EcosystemConfig --only $ProcessName 2>&1 | Out-Null
    & $Pm2Path save 2>&1 | Out-Null
    Write-Log "Started $ProcessName and saved PM2 state"
    exit
}

$status = $relay.pm2_env.status
$restarts = $relay.pm2_env.restart_time
$uptime = $relay.pm2_env.pm_uptime

if ($status -eq "online") {
    $uptimeMs = (Get-Date -UFormat %s) * 1000 - $uptime
    $uptimeMin = [math]::Round($uptimeMs / 60000)
    Write-Log "OK - $ProcessName online (uptime: ${uptimeMin}m, restarts: $restarts)"
} elseif ($status -eq "stopped" -or $status -eq "errored") {
    Write-Log "DOWN ($status) - $ProcessName has status '$status'. Restarting..."
    & $Pm2Path restart $ProcessName 2>&1 | Out-Null
    Start-Sleep -Seconds 5
    # Verify it came back
    $checkList = & $Pm2Path jlist 2>&1 | ConvertFrom-Json
    $checkRelay = $checkList | Where-Object { $_.name -eq $ProcessName }
    if ($checkRelay -and $checkRelay.pm2_env.status -eq "online") {
        Write-Log "RECOVERED - $ProcessName restarted successfully"
    } else {
        Write-Log "FAILED - $ProcessName did not recover after restart. Status: $($checkRelay.pm2_env.status)"
    }
    & $Pm2Path save 2>&1 | Out-Null
} else {
    Write-Log "UNKNOWN - $ProcessName has unexpected status '$status'"
}
