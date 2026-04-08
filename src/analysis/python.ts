import { spawn, ChildProcess } from 'child_process';
import { resolve, join, basename } from 'path';
import * as fs from 'fs';
import { SgnlError } from '../errors';
import { trackProcess } from '../utils/process-registry';

// Detect Python executable at module load time (prioritize local venv, then Homebrew)
function detectPythonPath(): string {
  const projectRoot = resolve(__dirname, '../..');
  const isWindows = process.platform === 'win32';

  const candidates = isWindows
    ? [
        join(projectRoot, '.venv', 'Scripts', 'python.exe'),
        join(projectRoot, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        join(projectRoot, '.venv', 'bin', 'python3'),
        join(projectRoot, 'venv', 'bin', 'python3'),
        '/opt/homebrew/bin/python3',
        '/home/linuxbrew/.linuxbrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3',
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return isWindows ? 'python' : 'python3';
}

const PYTHON_PATH = detectPythonPath();

/**
 * Result of a Python script execution
 */
export interface PythonResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
}

/**
 * Custom error classes for Python execution
 */
export class PythonError extends SgnlError {
  constructor(message: string, code = 'PYTHON_ERROR') {
    super(message, code);
    this.name = 'PythonError';
  }
}

export class PythonNotInstalledError extends PythonError {
  constructor(message = 'Python is not installed or not found in PATH') {
    super(message, 'PYTHON_NOT_INSTALLED');
    this.name = 'PythonNotInstalledError';
  }
}

export class PythonScriptError extends PythonError {
  constructor(message: string) {
    super(message, 'PYTHON_SCRIPT_ERROR');
    this.name = 'PythonScriptError';
  }
}

export class JSONParseError extends PythonError {
  constructor(message: string) {
    super(message, 'JSON_PARSE_ERROR');
    this.name = 'JSONParseError';
  }
}

export class TimeoutError extends PythonError {
  constructor(timeout: number) {
    super(`Python script execution timed out after ${timeout}ms`, 'PYTHON_TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class PythonRuntimeError extends PythonError {
  constructor(exitCode: number, stderr: string) {
    const truncatedStderr = stderr.length > 500 ? stderr.substring(0, 500) + '...' : stderr;
    super(`Python script exited with code ${exitCode}: ${truncatedStderr}`, 'PYTHON_RUNTIME_ERROR');
    this.name = 'PythonRuntimeError';
  }
}

/**
 * Whitelist of allowed Python scripts
 */
const ALLOWED_SCRIPTS = new Set(['split.py', 'xray.py', 'technical_seo.py', 'onpage.py', 'content_analysis.py', 'content_extract.py', 'robots_check.py', 'graph_analysis.py', 'schema_validator.py']);

/**
 * Validate script name against whitelist and path traversal attempts
 * @param scriptName - Name of the script to validate
 * @throws {PythonScriptError} if script is not whitelisted or contains path traversal
 */
function validateScriptName(scriptName: string): void {
  // Block path traversal attempts
  if (scriptName.includes('../') || scriptName.includes('..\\') || scriptName.startsWith('/')) {
    throw new PythonScriptError(`Path traversal attempt detected: ${scriptName}`);
  }

  // Block any path separators (no subdirectories allowed)
  if (scriptName.includes('/') || scriptName.includes('\\')) {
    throw new PythonScriptError(`Script not whitelisted: ${scriptName}. Allowed scripts: ${Array.from(ALLOWED_SCRIPTS).join(', ')}`);
  }

  // Check whitelist
  if (!ALLOWED_SCRIPTS.has(scriptName)) {
    throw new PythonScriptError(`Script not whitelisted: ${scriptName}. Allowed scripts: ${Array.from(ALLOWED_SCRIPTS).join(', ')}`);
  }
}

/**
 * Execute a Python script with safe stdin/stdout handling, timeout, and JSON validation
 * @param scriptName - Name of the script (must be whitelisted)
 * @param input - Input data to pass via stdin
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @returns Promise<string> - JSON string output from the script
 * @throws {PythonNotInstalledError} if Python is not installed
 * @throws {PythonScriptError} if script name is invalid or not whitelisted
 * @throws {TimeoutError} if script execution exceeds timeout
 * @throws {JSONParseError} if output is not valid JSON
 * @throws {PythonRuntimeError} if script exits with non-zero code
 */
export async function runPythonScript(scriptName: string, input: string, timeout = 30000, argv1?: string, pythonPath?: string): Promise<string> {
  // Validate script name
  validateScriptName(scriptName);

  // Resolve script path
  const scriptPath = resolve(__dirname, '../../python', basename(scriptName));

  const effectivePythonPath = pythonPath ?? PYTHON_PATH;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Start Python process with minimal environment (only PATH)
    const pythonEnv = {
      PATH: process.env.PATH || '',
    };

    let proc: ChildProcess;
    try {
      const options: any = {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: pythonEnv,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      };
      const scriptArgs = argv1 !== undefined ? [scriptPath, argv1] : [scriptPath];
      proc = spawn(effectivePythonPath, scriptArgs, options);
      trackProcess(proc);
    } catch {
      reject(new PythonNotInstalledError());
      return;
    }

    // Handle process errors (e.g., Python not found)
    proc.on('error', (err: any) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        reject(new PythonNotInstalledError());
      } else {
        reject(err);
      }
    });

    // Collect stdout
    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
    }

    // Collect stderr
    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      // Give process 1 second to die gracefully before forcing
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 1000);
    }, timeout);

    // Handle process completion
    proc.on('close', (exitCode: number | null) => {
      clearTimeout(timeoutHandle);

      // If timeout fired, reject with TimeoutError
      if (timedOut) {
        reject(new TimeoutError(timeout));
        return;
      }

      // If non-zero exit code, reject with PythonRuntimeError
      if (exitCode !== 0 && exitCode !== null) {
        reject(new PythonRuntimeError(exitCode, stderr));
        return;
      }

      // Try to parse JSON output
      try {
        const trimmedOutput = stdout.trim();
        if (!trimmedOutput) {
          reject(new JSONParseError('Script produced empty output'));
          return;
        }

        JSON.parse(trimmedOutput);
        resolve(trimmedOutput);
      } catch {
        reject(new JSONParseError(`Invalid JSON output: ${stdout.substring(0, 100)}`));
      }
    });

    // Write input to stdin and close
    if (proc.stdin) {
      proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
        // EPIPE = Python closed stdin early (already exited or done reading).
        // Non-fatal — let the 'close' event determine success/failure.
        if (err.code !== 'EPIPE') reject(err);
      });
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

/**
 * Execute a Python script and return parsed result
 * @param scriptName - Name of the script
 * @param input - Input data
 * @param timeout - Timeout in milliseconds
 * @returns Promise<PythonResult> - Parsed result with success flag and data
 */
export async function runPythonScriptSafe(scriptName: string, input: string, timeout = 30000, argv1?: string, pythonPath?: string): Promise<PythonResult> {
  try {
    const output = await runPythonScript(scriptName, input, timeout, argv1, pythonPath);
    const data = JSON.parse(output);
    return {
      success: true,
      data,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Run graph_analysis.py with crawl JSONL + metadata, output compact.json.
 * @param crawlFile - Path to crawl.jsonl
 * @param metadataFile - Path to metadata.json
 * @param outputFile - Path to write compact.json
 * @param timeout - Timeout in milliseconds (default: 300000)
 */
export async function runGraphAnalysis(
  crawlFile: string,
  metadataFile: string,
  outputFile: string,
  timeout = 300_000,
  pythonPath?: string,
): Promise<void> {
  const scriptPath = resolve(__dirname, '../../python', 'graph_analysis.py');
  const effectivePythonPath = pythonPath ?? PYTHON_PATH;

  return new Promise((res, rej) => {
    let timedOut = false;
    let proc: ChildProcess;
    try {
      proc = spawn(effectivePythonPath, [scriptPath, crawlFile, metadataFile, outputFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      trackProcess(proc);
    } catch {
      rej(new PythonNotInstalledError());
      return;
    }

    proc.on('error', (err: any) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') rej(new PythonNotInstalledError());
      else rej(err);
    });

    // Forward stderr to terminal so progress is visible
    if (proc.stderr) proc.stderr.pipe(process.stderr);

    let stderrBuf = '';
    if (proc.stderr) {
      proc.stderr.on('data', (d: Buffer) => { stderrBuf += d.toString(); });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 1000);
    }, timeout);

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) { rej(new TimeoutError(timeout)); return; }
      if (code !== 0 && code !== null) { rej(new PythonRuntimeError(code, stderrBuf)); return; }
      if (!fs.existsSync(outputFile)) {
        rej(new PythonScriptError(`graph_analysis.py did not produce output file: ${outputFile}`));
        return;
      }
      res();
    });
  });
}

/**
 * Run content_analysis.py with markdown input and page meta.
 * @param markdown - Clean markdown text from split.py
 * @param meta - Page title and meta description
 * @returns Promise<PythonResult>
 */
export async function runContentAnalysis(
  markdown: string,
  meta: { title: string; meta_description: string },
  pythonPath?: string,
): Promise<PythonResult> {
  return runPythonScriptSafe('content_analysis.py', markdown, 30000, JSON.stringify(meta), pythonPath);
}
