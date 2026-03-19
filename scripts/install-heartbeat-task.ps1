# Install PM2 Heartbeat as a Windows Scheduled Task
# Run this script once as Administrator to register the task.

$TaskName = "PM2-Heartbeat-Watchdog"
$ScriptPath = "C:\Users\crevi\claude-telegram-relay\scripts\pm2-heartbeat.ps1"
$Description = "Checks PM2 claude-telegram-relay every 5 minutes. Restarts if down."

# Check for admin privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this script as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell > 'Run as administrator', then run this script again."
    exit 1
}

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task '$TaskName'"
}

# Build the task
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 9999)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $Description

Write-Host ""
Write-Host "Scheduled task '$TaskName' installed successfully!" -ForegroundColor Green
Write-Host "  - Runs every 5 minutes"
Write-Host "  - Survives reboots"
Write-Host "  - Logs to: logs\pm2-heartbeat.log"
Write-Host ""
Write-Host "To check:   schtasks /query /tn '$TaskName'"
Write-Host "To remove:  Unregister-ScheduledTask -TaskName '$TaskName'"
Write-Host "To test:    powershell -File '$ScriptPath'"
