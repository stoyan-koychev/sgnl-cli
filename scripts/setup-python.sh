#!/usr/bin/env bash
# setup-python.sh — Install SGNL Python dependencies
# Usage: npm run setup-python  OR  bash scripts/setup-python.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIREMENTS="$SCRIPT_DIR/../python/requirements.txt"

echo "[sgnl setup] Checking Python..."

# Find Python binary
PYTHON_BIN=""
for bin in python3 python; do
  if command -v "$bin" &>/dev/null; then
    PYTHON_BIN="$bin"
    break
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "[sgnl setup] ERROR: Python not found in PATH."
  echo "[sgnl setup] Install Python 3.8+ from https://python.org"
  exit 1
fi

PYTHON_VERSION=$("$PYTHON_BIN" --version 2>&1)
echo "[sgnl setup] Found: $PYTHON_VERSION"

# Check minimum version (3.8+)
if ! "$PYTHON_BIN" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" 2>/dev/null; then
  echo "[sgnl setup] ERROR: Python 3.8+ required (found $PYTHON_VERSION)"
  exit 1
fi

# Verify requirements file
if [ ! -f "$REQUIREMENTS" ]; then
  echo "[sgnl setup] ERROR: requirements.txt not found at $REQUIREMENTS"
  exit 1
fi

echo "[sgnl setup] Installing from python/requirements.txt..."
"$PYTHON_BIN" -m pip install -r "$REQUIREMENTS" --quiet

# Verify key imports
echo "[sgnl setup] Verifying installation..."
for module in bs4 html2text lxml; do
  if "$PYTHON_BIN" -c "import $module" 2>/dev/null; then
    echo "[sgnl setup]   ✓ $module"
  else
    echo "[sgnl setup] ERROR: Could not import '$module' after installation."
    echo "[sgnl setup] Try manually: pip install -r python/requirements.txt"
    exit 1
  fi
done

echo "[sgnl setup] Python setup complete. ✓"
