# Modified for the Studio 4000 recording fixes. Runs the real engine with a synthetic loopback device.
param([string]$Config = "Release")
$ErrorActionPreference = "Stop"
$projectDir = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $projectDir "build\Studio4000_artefacts\$Config\Studio 4000.exe"
$stdout = Join-Path $projectDir "recording-test.log"
$stderr = Join-Path $projectDir "recording-test.err"
$process = Start-Process -FilePath $exe -ArgumentList "--selftest-recording" -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
if (-not $process.WaitForExit(120000)) {
    $process.Kill()
    throw "Recording loopback selftest timed out"
}
$process.Refresh()
Get-Content -LiteralPath $stdout
if ((Test-Path $stderr) -and (Get-Item $stderr).Length) { Get-Content -LiteralPath $stderr }
if ($process.ExitCode -ne 0) { throw "Recording loopback selftest failed ($($process.ExitCode))" }
if (-not (Select-String -LiteralPath $stdout -SimpleMatch "RECORDING SELFTEST PASSED" -Quiet)) {
    throw "Recording loopback selftest did not report success"
}
