# Builds the portable package (dist\Studio4000-<version>-win64.zip) from a Release build.
# -Install also copies it to %LOCALAPPDATA%\Programs\Studio 4000 and adds a Start-menu shortcut (current user, no admin).
param([switch]$Install, [string]$Config = "Release")

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$built = Join-Path $root "build\Studio4000_artefacts\$Config"
$exe = Join-Path $built "Studio 4000.exe"
if (-not (Test-Path $exe)) { throw "Build first: .\build.ps1 (missing $exe)" }

$version = (Get-Item $exe).VersionInfo.ProductVersion
if (-not $version) { $version = "0.1.0" }
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "Studio 4000"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item $exe $stage
foreach ($dir in "ui", "mcp", "server") { Copy-Item -Recurse (Join-Path $built $dir) (Join-Path $stage $dir) }
foreach ($name in @("README.md", "LICENSE", "DISCLAIMER.md", "PRIVACY.md", "NOTICE.md")) {
    Copy-Item (Join-Path $root $name) (Join-Path $stage $name)
}
Copy-Item (Join-Path $root "docs\HOW-TO.md") (Join-Path $stage "HOW-TO.md")
$commit = ""
try { $commit = (git -C $root rev-parse HEAD).Trim() } catch { $commit = "" }
if ($commit -notmatch '^[0-9a-f]{40}$') { $commit = "local" }
$versionJson = "{`r`n  `"commit`": `"$commit`",`r`n  `"version`": `"$version`"`r`n}`r`n"
[System.IO.File]::WriteAllText((Join-Path $stage "version.json"), $versionJson, (New-Object System.Text.UTF8Encoding $false))
$shots = Join-Path $root "docs\screenshots"
if (Test-Path $shots) {
    $shotDest = Join-Path $stage "docs\screenshots"
    New-Item -ItemType Directory -Force $shotDest | Out-Null
    Copy-Item (Join-Path $shots "*.png") $shotDest -ErrorAction SilentlyContinue
}

@"
Studio 4000 $version

Free to use. No subscription and no royalty on the music you make.
License, disclaimer, privacy, and third-party notices are in this folder.
Optional tip: https://buymeacoffee.com/b4bdev

Third-party components and their licences:
  JUCE 8                      AGPLv3 or commercial licence   https://juce.com
  Tracktion Engine            GPLv3 or commercial licence    https://github.com/Tracktion/tracktion_engine
  Airwindows effects          MIT                            https://www.airwindows.com
  SoundTouch                  LGPL                           https://www.surina.net/soundtouch/
  Steinberg ASIO SDK          Steinberg licence or GPL-3.0  https://www.steinberg.net/developers
  React, Zustand, Yjs, ws, Model Context Protocol SDK        MIT

VST is a registered trademark of Steinberg Media Technologies GmbH. ASIO is a trademark of Steinberg.
"@ | Set-Content -Encoding UTF8 (Join-Path $stage "NOTICE.txt")

$zip = Join-Path $dist "Studio4000-$version-win64.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("Portable package: {0} ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))

if ($Install) {
    $target = Join-Path $env:LOCALAPPDATA "Programs\Studio 4000"
    if (Get-Process "Studio 4000" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target*" }) {
        throw "Close Studio 4000 before installing over it"
    }
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Copy-Item -Recurse $stage $target

    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Programs")) "Studio 4000.lnk"))
    $lnk.TargetPath = Join-Path $target "Studio 4000.exe"
    $lnk.WorkingDirectory = $target
    $lnk.IconLocation = "$(Join-Path $target 'Studio 4000.exe'),0"
    $lnk.Description = "Record, mix and collaborate"
    $lnk.Save()
    Write-Host "Installed to $target with a Start-menu shortcut"

    $legacy = Join-Path $env:LOCALAPPDATA "Programs\Studio 3030"
    $legacyLnk = Join-Path ([Environment]::GetFolderPath("Programs")) "Studio 3030.lnk"
    if (Test-Path $legacyLnk) { Remove-Item -Force $legacyLnk }
    if ((Test-Path (Join-Path $legacy "Studio 3030.exe")) -and -not (Get-Process "Studio 3030" -ErrorAction SilentlyContinue)) {
        Remove-Item -Recurse -Force $legacy
        Write-Host "Removed the old Studio 3030 install"
    }
}
