# Decodes a saved CDP Page.captureScreenshot response into a PNG file.
# Usage: powershell -File tools\cdp-png.ps1 -Json <response.json> -Out docs\screenshots\x.png
param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][string]$Out)

$data = (Get-Content -Raw $Json | ConvertFrom-Json).data
[IO.File]::WriteAllBytes((Join-Path (Get-Location) $Out), [Convert]::FromBase64String($data))
Write-Host "Saved $Out"
