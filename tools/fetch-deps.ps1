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
Apply-IfMissing "tracktion-recording-block-sync.patch" "modules\tracktion_engine\playback\tracktion_EditPlaybackContext.cpp" "Studio 4000: align capture and playback"
Apply-IfMissing "tracktion-recording-reference-origin.patch" "modules\tracktion_engine\playback\tracktion_EditPlaybackContext.cpp" "Studio 4000: initialise the preceding reference block"
Apply-IfMissing "tracktion-recording-thumbnail-bins.patch" "modules\tracktion_engine\audio_files\tracktion_RecordingThumbnailManager.h" "Studio 4000: accumulate partial thumbnail bins"

Apply-IfMissing "tracktion-recording-stable-bins.patch" "modules\tracktion_engine\audio_files\tracktion_RecordingThumbnailManager.h" "Studio 4000: expose the captured length"

Apply-IfMissing "tracktion-automation-modifier-lifetime.patch" "modules\tracktion_engine\model\automation\tracktion_AutomatableParameter.cpp" "Studio 4000: retain automation modifiers"

Apply-IfMissing "tracktion-recording-arm-flush.patch" "modules\tracktion_engine\playback\devices\tracktion_InputDevice.h" "Studio 4000: flush queued arm/routing changes"

Apply-IfMissing "tracktion-clip-automation-destination.patch" "modules\tracktion_engine\model\automation\tracktion_AutomationCurveList.cpp" "Studio 4000: preserve an exact destination"

$juce = Join-Path $dest "modules\juce\CMakeLists.txt"
if (-not (Test-Path $juce)) {
    Write-Host "Fetching the JUCE submodule..."
    git -C $dest config submodule.modules/juce.url https://github.com/juce-framework/JUCE.git
    git -C $dest submodule update --init --recursive
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch the JUCE submodule" }
}

# Studio 4000 driver fix: fetch the official, version-pinned SDK on clean CI machines too.
$asioDir = Join-Path $root "external\asiosdk"
if (-not (Test-Path (Join-Path $asioDir "common\iasiodrv.h"))) {
    $asioArchive = Join-Path $env:TEMP "Studio4000-ASIO-$($deps.asio.version).zip"
    $asioUnpack = Join-Path $root "external\asio-download"
    Write-Host "Downloading the official ASIO SDK $($deps.asio.version)..."
    Invoke-WebRequest $deps.asio.url -OutFile $asioArchive
    Expand-Archive -LiteralPath $asioArchive -DestinationPath $asioUnpack -Force
    $header = Get-ChildItem -LiteralPath $asioUnpack -Filter "iasiodrv.h" -Recurse -File | Select-Object -First 1
    if (-not $header) { throw "ASIO SDK archive did not contain common/iasiodrv.h" }
    $sdkRoot = Split-Path (Split-Path $header.FullName -Parent) -Parent
    New-Item -ItemType Directory -Force $asioDir | Out-Null
    Copy-Item -Path (Join-Path $sdkRoot "*") -Destination $asioDir -Recurse -Force
}
if (-not (Test-Path (Join-Path $asioDir "common\iasiodrv.h"))) { throw "ASIO SDK setup failed" }
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
