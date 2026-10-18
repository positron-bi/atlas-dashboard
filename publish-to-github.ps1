$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$remoteUrl = 'https://github.com/positron-bi/atlas-dashboard.git'
Set-Location -LiteralPath $root

if (Get-ChildItem -LiteralPath $root -Filter '*.pbix' -Recurse -File -ErrorAction SilentlyContinue) {
    throw 'PBIX source file found in this folder. Remove it before publishing.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { git init -b main $root | Out-Null }

$gitName = git config user.name
$gitEmail = git config user.email
if (-not $gitName -or -not $gitEmail) { throw 'Configure git user.name and user.email before publishing.' }
$configuredRemote = git remote get-url origin 2>$null
if (-not $configuredRemote) { git remote add origin $remoteUrl }
elseif ($configuredRemote.TrimEnd('/') -ne $remoteUrl.TrimEnd('/')) { throw "Unexpected origin remote: $configuredRemote" }

git add -A
if (-not (git diff --cached --quiet)) { git commit -m 'Build Atlas financial dashboard' }
git push --set-upstream origin main
Write-Host 'Published Atlas dashboard to GitHub.'
