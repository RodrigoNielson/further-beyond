param(
    [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$manifest = Get-Content (Join-Path $root "manifest.json") | ConvertFrom-Json
$zipName = "further-beyond-$($manifest.version).zip"
$zipPath = Join-Path $root (Join-Path $OutputDir $zipName)

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

$itemsToPackage = @(
    "manifest.json",
    "README.md",
    "background",
    "content",
    "icons",
    "popup",
    "shared"
)

Compress-Archive -Path $itemsToPackage -DestinationPath $zipPath -Force
Write-Output "Built extension package: $zipPath"
