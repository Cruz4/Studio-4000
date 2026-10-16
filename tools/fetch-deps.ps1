# Clones Tracktion Engine at the pinned commit and applies the Studio 4000 monitor patch.
# Leaves an existing checkout alone when that patch is already in the file.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root "external\tracktion_engine"
$deps = Get-Content (Join-Path $PSScriptRoot "deps.json") -Raw | ConvertFrom-Json
$commit = $deps.tracktion_engine.commit
$url = $deps.tracktion_engine.url
$patch = Join-Path $root "patches\tracktion-input-monitor.patch"
$marker = Join-Path $dest "modules\tracktion_engine\playback\devices\tracktion_InputDevice.cpp"

if (Test-Path $marker) {
    $text = Get-Content $marker -Raw
    if ($text -match "Studio 4000 patch") {
        Write-Host "Tracktion Engine is already present, with the monitor patch."
    } else {
        Write-Host "Applying the monitor patch to the Tracktion Engine checkout."
        git -C $dest apply --whitespace=nowarn $patch
        if ($LASTEXITCODE -ne 0) { throw "Could not apply $patch" }
    }
} else {
    Write-Host "Cloning Tracktion Engine ($commit)..."
    New-Item -ItemType Directory -Force (Join-Path $root "external") | Out-Null
    git clone $url $dest
    if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
    git -C $dest checkout $commit
    if ($LASTEXITCODE -ne 0) { throw "git checkout $commit failed" }
    git -C $dest apply --whitespace=nowarn $patch
    if ($LASTEXITCODE -ne 0) { throw "Could not apply $patch" }
    Write-Host "Tracktion Engine is ready."
}

function Apply-IfMissing($patchName, $relativeFile, $marker) {
    $file = Join-Path $dest $relativeFile
    if (-not (Test-Path $file)) { return }
    $text = Get-Content $file -Raw
    if ($text.Contains($marker)) { return }
    $patch = Join-Path $root "patches\$patchName"
    Write-Host "Applying $patchName"
    git -C $dest apply --whitespace=nowarn $patch
    if ($LASTEXITCODE -ne 0) { throw "Could not apply $patch" }
}

Apply-IfMissing "tracktion-chorus-params.patch" "modules\tracktion_engine\plugins\effects\tracktion_Chorus.cpp" "Studio 4000: chorus parameters"
Apply-IfMissing "tracktion-fader-headroom.patch" "modules\tracktion_engine\plugins\internal\tracktion_VolumeAndPan.cpp" "Studio 4000: fader headroom"

$juce = Join-Path $dest "modules\juce\CMakeLists.txt"
if (-not (Test-Path $juce)) {
    Write-Host "Fetching the JUCE submodule..."
    git -C $dest config submodule.modules/juce.url https://github.com/juce-framework/JUCE.git
    git -C $dest submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch the JUCE submodule" }
}

$asio = Join-Path $root "external\asiosdk\common"
if (-not (Test-Path $asio)) {
    Write-Host "ASIO SDK is not in external\asiosdk. Download it from Steinberg and keep their license with it. VST3 hosting still builds; ASIO drivers need this folder."
}
$wv = Join-Path $root "external\webview2"
$wvPkg = Join-Path $wv "Microsoft.Web.WebView2.$($deps.webview2)"
if (-not (Test-Path (Join-Path $wvPkg "build\native\include\WebView2.h"))) {
    $ver = $deps.webview2
    Write-Host "Downloading the WebView2 package $ver..."
    New-Item -ItemType Directory -Force $wvPkg | Out-Null
    $zip = Join-Path $env:TEMP "Microsoft.Web.WebView2.$ver.zip"
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$ver" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $wvPkg -Force
    Remove-Item $zip -Force
}
