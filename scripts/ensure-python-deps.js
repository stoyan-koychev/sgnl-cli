#!/usr/bin/env node
/**
 * ensure-python-deps.js
 * Checks and installs required Python dependencies for SGNL.
 * Run automatically via postinstall, or manually: node scripts/ensure-python-deps.js
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQUIREMENTS = path.join(__dirname, '..', 'python', 'requirements.txt');
const REQUIRED_MODULES = ['bs4', 'html2text', 'lxml'];

function log(msg) {
  process.stdout.write(`[sgnl setup] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[sgnl setup] WARNING: ${msg}\n`);
}

/** Check if a Python module is importable */
function isModuleInstalled(pythonBin, module) {
  const result = spawnSync(pythonBin, ['-c', `import ${module}`], { encoding: 'utf8' });
  return result.status === 0;
}

/** Find a working Python binary, preferring venv then Homebrew then system */
function findPython() {
  const isWindows = process.platform === 'win32';
  const candidates = isWindows
    ? [
        path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe'),
        path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe'),
        'python',
        'python3',
      ]
    : [
        path.join(__dirname, '..', '.venv', 'bin', 'python3'),
        path.join(__dirname, '..', 'venv', 'bin', 'python3'),
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/home/linuxbrew/.linuxbrew/bin/python3',
        'python3',
        'python',
      ];
  for (const bin of candidates) {
    const result = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return bin;
  }
  return null;
}

function main() {
  const pythonBin = findPython();

  if (!pythonBin) {
    warn('Python not found in PATH. Python analysis features will be unavailable.');
    warn('Install Python 3.8+ and run: npm run setup-python');
    // Non-fatal: postinstall should not block npm install
    process.exit(0);
  }

  // Check which modules are missing
  const missing = REQUIRED_MODULES.filter(m => !isModuleInstalled(pythonBin, m));

  if (missing.length === 0) {
    log('Python dependencies already satisfied. ✓');
    process.exit(0);
  }

  log(`Missing Python modules: ${missing.join(', ')}`);
  log('Installing from python/requirements.txt...');

  if (!fs.existsSync(REQUIREMENTS)) {
    warn(`requirements.txt not found at ${REQUIREMENTS}`);
    process.exit(0);
  }

  const install = spawnSync(
    pythonBin,
    ['-m', 'pip', 'install', '-r', REQUIREMENTS, '--quiet'],
    { encoding: 'utf8', stdio: 'inherit' }
  );

  if (install.status !== 0) {
    warn('pip install failed. Run manually: pip install -r python/requirements.txt');
    warn('Python analysis will be unavailable until dependencies are installed.');
    // Non-fatal exit — don't break npm install
    process.exit(0);
  }

  // Verify installation
  const stillMissing = REQUIRED_MODULES.filter(m => !isModuleInstalled(pythonBin, m));
  if (stillMissing.length > 0) {
    warn(`Could not verify: ${stillMissing.join(', ')}. Check your Python environment.`);
    process.exit(0);
  }

  log('Python dependencies installed successfully. ✓');
  process.exit(0);
}

main();
