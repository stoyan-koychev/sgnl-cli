/**
 * Minimal structured logger with level filtering.
 *
 * All output goes to stderr to keep stdout clean for JSON/data output.
 * Wire --verbose to logger.setLevel('debug') in command handlers.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(msg: string): void {
    this.emit('debug', msg);
  }

  info(msg: string): void {
    this.emit('info', msg);
  }

  warn(msg: string): void {
    this.emit('warn', msg);
  }

  error(msg: string): void {
    this.emit('error', msg);
  }

  private emit(level: LogLevel, msg: string): void {
    if (LEVEL_VALUES[level] < LEVEL_VALUES[this.level]) return;
    process.stderr.write(`${msg}\n`);
  }
}

/** Singleton logger instance */
export const logger = new Logger();
