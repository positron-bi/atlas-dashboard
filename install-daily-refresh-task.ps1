$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root '.env.local'
$refreshScript = Join-Path $root 'refresh-and-publish.ps1'
$taskName = 'Atlas Dashboard Daily Refresh'

if (-not (Test-Path -LiteralPath $envFile)) { throw 'Create .env.local with SQL_SERVER and SQL_DATABASE first.' }
$remote = git -C $root remote get-url origin 2>$null
if ($remote -ne 'https://github.com/positron-bi/atlas-dashboard.git') { throw 'Publish and verify the GitHub origin before installing the daily task.' }
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw "Task '$taskName' already exists; inspect it before changing anything." }

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$refreshScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At '3:00AM'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Refresh only monthly Atlas aggregates and push changed dashboard data.' | Out-Null
Write-Host "Installed '$taskName'. The user must be logged in, the machine connected to SQL Server, and GitHub credentials available at 3 AM."
