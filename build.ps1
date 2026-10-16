param(
    [ValidateSet("Release", "Debug", "RelWithDebInfo")]
    [string]$Config = "Release",
    [switch]$SkipUi,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$buildDir = Join-Path $root "build"
$vs = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"

if (-not (Test-Path "$vs\VC\Auxiliary\Build\vcvars64.bat")) {
    $vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath
}

# Import the MSVC x64 developer environment into this session (once; vcvars keeps prepending to PATH).
if (-not $env:VSCMD_VER -or $env:VSCMD_ARG_TGT_ARCH -ne "x64") {
    cmd /c "`"$vs\VC\Auxiliary\Build\vcvars64.bat`" >nul && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
    }
}

$cmakeDir = "$vs\Common7\IDE\CommonExtensions\Microsoft\CMake"
if ($env:PATH -notlike "*$cmakeDir\Ninja*") { $env:PATH = "$cmakeDir\CMake\bin;$cmakeDir\Ninja;$env:PATH" }

if (-not (Test-Path "$root\resources\icon.png")) {
    New-Item -ItemType Directory -Force "$root\resources" | Out-Null
    python "$root\tools\make_icon.py" "$root\resources\icon.png"
}

if (-not $SkipUi) {
    Push-Location "$root\ui"
    if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
    npm run build
    Pop-Location

    foreach ($pkg in "mcp", "server") {
        Push-Location "$root\$pkg"
        if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund --omit=dev }
        Pop-Location
    }
}

if ($Clean -and (Test-Path $buildDir)) { Remove-Item -Recurse -Force $buildDir }

cmake -S $root -B $buildDir -G Ninja "-DCMAKE_BUILD_TYPE=$Config"
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }

cmake --build $buildDir --config $Config -- -k 0
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

Write-Host "Built: $buildDir\Studio4000_artefacts\$Config\Studio 4000.exe"
