# setup-python.ps1 — Install SGNL Python dependencies (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-python.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Requirements = Join-Path $ScriptDir "..\python\requirements.txt"

Write-Host "[sgnl setup] Checking Python..."

# Find Python binary
$PythonBin = $null
foreach ($bin in @("python3", "python")) {
    try {
        $result = & $bin --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $PythonBin = $bin
            break
        }
    } catch { }
}

if (-not $PythonBin) {
    Write-Host "[sgnl setup] ERROR: Python not found in PATH."
    Write-Host "[sgnl setup] Install Python 3.8+ from https://python.org"
    Write-Host "[sgnl setup] Or: winget install Python.Python.3.12"
    exit 1
}

$PythonVersion = & $PythonBin --version 2>&1
Write-Host "[sgnl setup] Found: $PythonVersion"

# Verify requirements file
if (-not (Test-Path $Requirements)) {
    Write-Host "[sgnl setup] ERROR: requirements.txt not found at $Requirements"
    exit 1
}

Write-Host "[sgnl setup] Installing from python/requirements.txt..."
& $PythonBin -m pip install -r $Requirements --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "[sgnl setup] ERROR: pip install failed."
    Write-Host "[sgnl setup] Try: $PythonBin -m pip install -r python/requirements.txt"
    exit 1
}

# Verify key imports
Write-Host "[sgnl setup] Verifying installation..."
foreach ($module in @("bs4", "html2text", "lxml")) {
    & $PythonBin -c "import $module" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[sgnl setup]   ✓ $module"
    } else {
        Write-Host "[sgnl setup] ERROR: Could not import '$module' after installation."
        exit 1
    }
}

Write-Host "[sgnl setup] Python setup complete. ✓"
