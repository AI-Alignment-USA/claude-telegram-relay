$action = New-ScheduledTaskAction -Execute 'C:\Users\crevi\.bun\bin\pm2.exe' -Argument 'resurrect'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName 'PM2 Startup' -Action $action -Trigger $trigger -Description 'Start PM2 and resurrect saved processes on login' -Force
Write-Host 'Scheduled task created successfully.'
