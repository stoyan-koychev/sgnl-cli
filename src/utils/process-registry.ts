/**
 * Child process registry for graceful shutdown.
 *
 * Tracks spawned child processes so they can be killed
 * when the CLI receives SIGINT/SIGTERM, preventing orphans.
 */

import type { ChildProcess } from 'child_process';

const childProcesses = new Set<ChildProcess>();

/**
 * Register a child process for cleanup on shutdown.
 * Automatically removes it when the process exits.
 */
export function trackProcess(proc: ChildProcess): void {
  childProcesses.add(proc);
  proc.on('exit', () => childProcesses.delete(proc));
  proc.on('error', () => childProcesses.delete(proc));
}

/**
 * Kill all tracked child processes. Called on SIGINT/SIGTERM.
 */
export function killAllChildren(): void {
  for (const proc of childProcesses) {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  }
  childProcesses.clear();
}
