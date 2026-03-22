param(
    [string]$VenvPath
)

$ErrorActionPreference = "Stop"


$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
$requirementsPath = Join-Path $projectRoot "requirements-python.txt"

if ([string]::IsNullOrWhiteSpace($VenvPath)) {
    $VenvPath = Join-Path $projectRoot ".venv"
}

if (-not (Test-Path $requirementsPath)) {
    throw "requirements file not found at $requirementsPath"
}

Write-Host "[python-setup] Project root: $projectRoot"
Write-Host "[python-setup] Creating virtual environment at '$VenvPath'..."
python -m venv $VenvPath

$venvPython = Join-Path $VenvPath "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    throw "Virtual environment python executable not found at $venvPython"
}

Write-Host "[python-setup] Upgrading pip tooling..."
& $venvPython -m pip install --upgrade pip setuptools wheel

Write-Host "[python-setup] Installing project dependencies..."
& $venvPython -m pip install -r $requirementsPath

Write-Host "[python-setup] Done."
$activationScript = Join-Path $VenvPath "Scripts\Activate.ps1"
Write-Host "[python-setup] Activate with: $activationScript"
