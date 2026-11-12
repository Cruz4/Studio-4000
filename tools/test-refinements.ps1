param([string]$Config = "Release")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
node "$PSScriptRoot\export-presets.mjs"
if ($LASTEXITCODE -ne 0) { throw "Could not export preset banks" }
$exe = Join-Path $root "build\Studio4000_artefacts\$Config\Studio 4000.exe"
$stdout = Join-Path $root "refinement-test.log"
$stderr = Join-Path $root "refinement-test.err"
$process = Start-Process -FilePath $exe -ArgumentList "--selftest-refinements" -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$null = $process.Handle
if (-not $process.WaitForExit(120000)) { $process.Kill(); throw "Refinement selftest timed out" }
$process.Refresh()
Get-Content -LiteralPath $stdout
if ((Test-Path $stderr) -and (Get-Item $stderr).Length) { Get-Content -LiteralPath $stderr }
if ($process.ExitCode -ne 0) { throw "Refinement selftest failed ($($process.ExitCode))" }
if (-not (Select-String -LiteralPath $stdout -SimpleMatch "REFINEMENT SELFTEST PASSED" -Quiet)) { throw "Refinement selftest did not report success" }
