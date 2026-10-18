$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

python (Join-Path $root 'python\refresh_from_sql.py')
if ($LASTEXITCODE -ne 0) { throw 'Data refresh failed; GitHub was not updated.' }

git add -- 'data/dashboard-data.json'
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host 'No monthly aggregate changes; nothing to push.'; exit 0 }
if ($LASTEXITCODE -ne 1) { throw 'Could not inspect staged changes.' }

git commit -m 'Refresh Atlas monthly aggregates'
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Push failed.' }
Write-Host 'Monthly aggregates refreshed and pushed.'
