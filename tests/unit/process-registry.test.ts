import { trackProcess, killAllChildren } from '../../src/utils/process-registry';
import { EventEmitter } from 'events';

/** Minimal mock ChildProcess for testing */
function createMockProc(): any {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    killed: false,
    kill(signal?: string) {
      this.killed = true;
    },
  });
}

describe('process-registry', () => {
  afterEach(() => {
    // Clean up between tests
    killAllChildren();
  });

  it('should track a process and kill it on killAllChildren', () => {
    const proc = createMockProc();
    trackProcess(proc);
    killAllChildren();
    expect(proc.killed).toBe(true);
  });

  it('should auto-remove process when it exits', () => {
    const proc = createMockProc();
    trackProcess(proc);

    // Simulate process exit
    proc.emit('exit', 0);

    // Now killAllChildren should have nothing to kill
    proc.killed = false; // reset
    killAllChildren();
    expect(proc.killed).toBe(false); // was not killed again
  });

  it('should auto-remove process on error', () => {
    const proc = createMockProc();
    trackProcess(proc);

    proc.emit('error', new Error('spawn failed'));

    proc.killed = false;
    killAllChildren();
    expect(proc.killed).toBe(false);
  });

  it('should handle multiple processes', () => {
    const proc1 = createMockProc();
    const proc2 = createMockProc();
    const proc3 = createMockProc();

    trackProcess(proc1);
    trackProcess(proc2);
    trackProcess(proc3);

    // Remove one via exit
    proc2.emit('exit', 0);

    killAllChildren();
    expect(proc1.killed).toBe(true);
    expect(proc2.killed).toBe(false); // was removed before kill
    expect(proc3.killed).toBe(true);
  });

  it('should not throw when killing an already-killed process', () => {
    const proc = createMockProc();
    proc.killed = true; // already killed
    trackProcess(proc);
    expect(() => killAllChildren()).not.toThrow();
  });
});
