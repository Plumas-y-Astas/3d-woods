param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Icon = "desktop/logo.ico",
  [string]$Output = "icon_windows_amd64.syso",
  [string]$Config = "versioninfo.json"
)

$ErrorActionPreference = "Stop"
$clean = $Version.Trim().TrimStart("v", "V")
if ($clean -notmatch '^\d+\.\d+\.\d+$') {
  throw "La versión debe tener el formato 0.0.0 (por ejemplo v0.8.0). Recibido: $Version"
}
$parts = $clean.Split(".") | ForEach-Object { [int]$_ }

$json = Get-Content -LiteralPath $Config -Raw -Encoding utf8 | ConvertFrom-Json
$json.FixedFileInfo.FileVersion.Major = $parts[0]
$json.FixedFileInfo.FileVersion.Minor = $parts[1]
$json.FixedFileInfo.FileVersion.Patch = $parts[2]
$json.FixedFileInfo.FileVersion.Build = 0
$json.FixedFileInfo.ProductVersion.Major = $parts[0]
$json.FixedFileInfo.ProductVersion.Minor = $parts[1]
$json.FixedFileInfo.ProductVersion.Patch = $parts[2]
$json.FixedFileInfo.ProductVersion.Build = 0
$json.StringFileInfo.FileVersion = "$clean.0"
$json.StringFileInfo.ProductVersion = $clean
$text = $json | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($Config, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Generando recursos de Windows para 3D-Woods $clean (Plumas y Astas Studio)…"
go run github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.7.0 -icon $Icon -o $Output $Config
if ($LASTEXITCODE -ne 0) {
  throw "goversioninfo no pudo generar $Output"
}
if (-not (Test-Path -LiteralPath $Output)) {
  throw "No se generó $Output"
}
Write-Host "Listo: $Output"
